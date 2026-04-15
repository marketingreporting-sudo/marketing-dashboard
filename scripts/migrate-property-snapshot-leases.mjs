import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const CHECKPOINT_PATH = path.join(ROOT_DIR, "migration-output", "firestore-json", "property-snapshot-leases-checkpoint.json");
const BATCH_SIZE = Number.parseInt(process.env.SUPABASE_BATCH_SIZE ?? "250", 10);
const MAX_RETRIES = Number.parseInt(process.env.FIRESTORE_RETRY_ATTEMPTS ?? "5", 10);
const RETRY_DELAY_MS = Number.parseInt(process.env.FIRESTORE_RETRY_DELAY_MS ?? "2000", 10);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveServiceAccountPath() {
  const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH;
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const configuredPath = explicitPath ?? adcPath;

  if (!configuredPath) {
    throw new Error(
      "Set FIREBASE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_APPLICATION_CREDENTIALS to a Firebase service account JSON file.",
    );
  }

  return configuredPath;
}

function initializeFirebaseAdmin() {
  const serviceAccountPath = resolveServiceAccountPath();
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId:
        process.env.FIREBASE_PROJECT_ID ??
        serviceAccount.project_id ??
        process.env.GOOGLE_CLOUD_PROJECT,
    });
  }

  return admin.firestore();
}

function createSupabase() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizeFirestoreValue(value) {
  const timestampCtor = admin.firestore.Timestamp;
  const geoPointCtor = admin.firestore.GeoPoint;
  const documentReferenceCtor = admin.firestore.DocumentReference;
  const bytesCtor = admin.firestore.Bytes;

  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => normalizeFirestoreValue(item));
  if (timestampCtor && value instanceof timestampCtor) return value.toDate().toISOString();
  if (geoPointCtor && value instanceof geoPointCtor) {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (documentReferenceCtor && value instanceof documentReferenceCtor) return value.path;
  if (bytesCtor && value instanceof bytesCtor) return value.toBase64();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeFirestoreValue(nestedValue)]),
    );
  }
  return value;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, fn) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      console.warn(`[retry] ${label} failed on attempt ${attempt}/${MAX_RETRIES}: ${error.message}`);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function readCheckpoint() {
  try {
    return JSON.parse(await fs.readFile(CHECKPOINT_PATH, "utf8"));
  } catch {
    return {
      processedLeaseDocs: 0,
      lastProcessedPath: null,
    };
  }
}

async function writeCheckpoint(checkpoint) {
  await fs.mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await fs.writeFile(
    CHECKPOINT_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        ...checkpoint,
      },
      null,
      2,
    ),
  );
}

function isPropertySnapshotLeasePath(docPath) {
  return /^property_data\/[^/]+\/leases\/[^/]+$/.test(docPath);
}

function buildRow(doc) {
  const nestedData = normalizeFirestoreValue(doc.data() ?? {});
  const pathParts = doc.ref.path.split("/");
  const propertySnapshotId = pathParts[1];
  const leaseId = pathParts[3];
  const [propertyId, activityDateCandidate] = propertySnapshotId.split("_");

  return {
    id: doc.ref.path,
    property_snapshot_id: propertySnapshotId,
    property_id: propertyId ?? null,
    activity_date: toDateString(activityDateCandidate),
    lease_id: leaseId,
    reporting_window_start: toDateString(nestedData.reporting_window_start),
    reporting_window_end: toDateString(nestedData.reporting_window_end),
    attribution_status: nestedData.attribution_status ?? null,
    attribution_event_date: toDateString(nestedData.attribution_event_date),
    lease_term_months: nestedData.lease_term_months ?? null,
    lease_start_date: toDateString(nestedData.lease_start_date),
    lease_end_date: toDateString(nestedData.lease_end_date),
    move_in_date: toDateString(nestedData.move_in_date),
    move_out_date: toDateString(nestedData.move_out_date),
    gross_lease_value: toNumber(nestedData.gross_lease_value),
    net_effective_rent: toNumber(nestedData.net_effective_rent),
    net_effective_revenue: toNumber(nestedData.net_effective_revenue),
    concession_total: toNumber(nestedData.concession_total),
    lead_attribution: nestedData.lead_attribution ?? {},
    raw_data: nestedData,
    last_synced_at: toIso(nestedData.last_synced_at),
    firestore_path: doc.ref.path,
  };
}

async function upsertRows(supabase, rows) {
  for (const chunk of chunkArray(rows, BATCH_SIZE)) {
    await withRetry(`supabase upsert property_snapshot_leases chunk(${chunk.length})`, async () => {
      const { error } = await supabase.from("property_snapshot_leases").upsert(chunk, { onConflict: "id" });
      if (error) throw error;
    });
  }
}

async function main() {
  const db = initializeFirebaseAdmin();
  const supabase = createSupabase();
  const checkpoint = await readCheckpoint();

  const leaseSnapshot = await withRetry("firestore collectionGroup(leases).get()", async () =>
    db.collectionGroup("leases").get(),
  );

  const propertySnapshotLeaseDocs = leaseSnapshot.docs
    .filter((doc) => isPropertySnapshotLeasePath(doc.ref.path))
    .sort((left, right) => left.ref.path.localeCompare(right.ref.path));

  const resumeIndex = checkpoint.lastProcessedPath
    ? propertySnapshotLeaseDocs.findIndex((doc) => doc.ref.path > checkpoint.lastProcessedPath)
    : 0;
  const docsToProcess =
    resumeIndex >= 0 ? propertySnapshotLeaseDocs.slice(resumeIndex) : propertySnapshotLeaseDocs;

  const pendingRows = [];
  let processedLeaseDocs = checkpoint.processedLeaseDocs ?? 0;
  let processedSnapshots = 0;
  let snapshotsWithLeases = 0;
  let lastSnapshotId = null;
  let lastProcessedPath = checkpoint.lastProcessedPath ?? null;

  for (const doc of docsToProcess) {
    const row = buildRow(doc);
    pendingRows.push(row);
    processedLeaseDocs += 1;
    lastProcessedPath = doc.ref.path;

    if (row.property_snapshot_id !== lastSnapshotId) {
      processedSnapshots += 1;
      snapshotsWithLeases += 1;
      lastSnapshotId = row.property_snapshot_id;
    }

    if (pendingRows.length >= BATCH_SIZE) {
      await upsertRows(supabase, pendingRows.splice(0, pendingRows.length));
      await writeCheckpoint({ processedLeaseDocs, processedSnapshots, snapshotsWithLeases, lastProcessedPath });
      console.log(
        `[progress] Processed ${processedLeaseDocs}/${propertySnapshotLeaseDocs.length} lease docs; snapshots with leases: ${snapshotsWithLeases}`,
      );
    }
  }

  if (pendingRows.length > 0) {
    await upsertRows(supabase, pendingRows);
  }

  await writeCheckpoint({
    processedLeaseDocs,
    processedSnapshots,
    snapshotsWithLeases,
    lastProcessedPath,
    completed: true,
  });

  const { count, error } = await supabase.from("property_snapshot_leases").select("*", { count: "exact", head: true });
  if (error) throw error;

  console.log(
    JSON.stringify(
      {
        processedLeaseDocs,
        processedSnapshots,
        snapshotsWithLeases,
        propertySnapshotLeases: count,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Snapshot lease migration failed.");
  console.error(error);
  process.exitCode = 1;
});
