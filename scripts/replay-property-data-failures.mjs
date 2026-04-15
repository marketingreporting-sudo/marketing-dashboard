import { readFileSync } from "node:fs";
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
const DEFAULT_MANIFEST_PATH = path.join(ROOT_DIR, "migration-output", "firestore-json", "relational-manifest.json");
const BATCH_SIZE = Number.parseInt(process.env.SUPABASE_BATCH_SIZE ?? "250", 10);

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

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(ROOT_DIR, configuredPath);
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

function normalizeConflictColumns(onConflict) {
  return String(onConflict)
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function dedupeRowsByConflict(rows, onConflict) {
  const conflictColumns = normalizeConflictColumns(onConflict);
  if (conflictColumns.length === 0) return rows;

  const deduped = new Map();
  for (const row of rows) {
    const key = conflictColumns
      .map((column) => {
        const value = row[column];
        return value == null ? "__null__" : JSON.stringify(value);
      })
      .join("|");
    deduped.set(key, row);
  }

  return [...deduped.values()];
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function upsertRows(supabase, table, rows, onConflict) {
  if (rows.length === 0) return 0;
  const dedupedRows = dedupeRowsByConflict(rows, onConflict);
  for (const chunk of chunkArray(dedupedRows, BATCH_SIZE)) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
  }
  return dedupedRows.length;
}

function loadFailedPropertyDataPaths() {
  const manifestPath = process.env.RELATIONAL_MANIFEST_PATH
    ? path.resolve(ROOT_DIR, process.env.RELATIONAL_MANIFEST_PATH)
    : DEFAULT_MANIFEST_PATH;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return (manifest.failedDocuments ?? [])
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath?.startsWith("property_data/"));
}

async function main() {
  const docPaths = loadFailedPropertyDataPaths();
  if (docPaths.length === 0) {
    console.log("No failed property_data document paths found in the manifest.");
    return;
  }

  const db = initializeFirebaseAdmin();
  const supabase = createSupabase();

  const parentRows = [];
  const leadRows = [];
  const eventRows = [];
  const invoiceRows = [];
  const availabilityRows = [];
  const missingPaths = [];

  for (const docPath of docPaths) {
    const doc = await db.doc(docPath).get();
    if (!doc.exists) {
      missingPaths.push(docPath);
      continue;
    }

    const data = normalizeFirestoreValue(doc.data() ?? {});
    const propertyId = data.property_id != null ? String(data.property_id) : null;
    const activityDate = toDateString(data.date ?? data.activity_date);

    parentRows.push({
      id: doc.id,
      property_id: propertyId,
      activity_date: activityDate,
      activity_at: toIso(data.activity_date),
      source_date_id: data.date ?? activityDate ?? doc.id,
      raw_data: data,
      firestore_path: doc.ref.path,
    });

    for (const subcollection of await doc.ref.listCollections()) {
      const nestedSnapshot = await subcollection.get();
      for (const nested of nestedSnapshot.docs) {
        const nestedData = normalizeFirestoreValue(nested.data() ?? {});
        const payload = nestedData.data ?? {};
        const nestedPath = nested.ref.path;

        if (subcollection.id === "leads") {
          leadRows.push({
            id: nestedPath,
            property_snapshot_id: doc.id,
            property_id: propertyId,
            activity_date: activityDate,
            lead_id: payload.leadId ?? payload.leadID ?? payload.prospectId ?? payload.prospectID ?? payload.id ?? null,
            application_id: payload.applicationId ?? null,
            customer_id: payload.customerId ?? payload.customerID ?? null,
            prospect_id: payload.prospectId ?? payload.prospectID ?? null,
            status: payload.status ?? null,
            lead_source: payload.leadSource ?? null,
            internet_listing_service: payload.internetListingService ?? null,
            attribution: nestedData.attribution ?? {},
            lease_ids: nestedData.leaseIds ?? [],
            lease_paths: nestedData.leasePaths ?? [],
            raw_data: payload,
            firestore_path: nestedPath,
          });
        } else if (subcollection.id === "events") {
          eventRows.push({
            id: nestedPath,
            property_snapshot_id: doc.id,
            property_id: propertyId,
            activity_date: activityDate,
            event_id: payload.eventId ?? payload.eventID ?? payload.id ?? null,
            type_id: payload.typeId ?? null,
            event_type: payload.type ?? null,
            event_reason: payload.eventReason ?? null,
            application_id: payload.applicationId ?? null,
            lease_id: payload.leaseId ?? null,
            lease_interval_id: payload.leaseIntervalId ?? null,
            raw_data: payload,
            firestore_path: nestedPath,
          });
        } else if (subcollection.id === "invoices") {
          invoiceRows.push({
            id: nestedPath,
            property_snapshot_id: doc.id,
            property_id: propertyId,
            activity_date: activityDate,
            invoice_id: payload.invoiceId ?? payload.invoiceID ?? payload.arInvoiceId ?? payload.referenceNumber ?? payload.id ?? null,
            reference_number: payload.referenceNumber ?? payload.reference ?? null,
            vendor_name: payload.vendorName ?? null,
            contract: payload.contract ?? null,
            post_date: toDateString(payload.postDate),
            invoice_date: toDateString(payload.invoiceDate),
            transaction_date: toDateString(payload.transactionDate),
            post_month: payload.postMonth ?? null,
            amount: toNumber(payload.totalAmount ?? payload.amount ?? payload.invoiceAmount),
            gl_account_number: payload.glAccount?.accountNumber ?? null,
            gl_account_name: payload.glAccount?.accountName ?? null,
            raw_data: payload,
            firestore_path: nestedPath,
          });
        } else if (subcollection.id === "availability") {
          availabilityRows.push({
            id: nestedPath,
            property_snapshot_id: doc.id,
            property_id: propertyId,
            activity_date: activityDate,
            unit_id: payload.unitId ?? payload.unitID ?? payload.id ?? null,
            unit_number: payload.unitNumber ?? null,
            floorplan_name: payload.floorplanName ?? payload.floorPlanName ?? null,
            availability_status: payload.availabilityStatus ?? payload.status ?? null,
            available_on: toDateString(payload.availableOn ?? payload.availableDate ?? payload.availabilityDate),
            price: toNumber(
              payload.bestPrice ?? payload.effectiveRent ?? payload.rent ?? payload.marketRent ?? payload.price,
            ),
            raw_data: payload,
            firestore_path: nestedPath,
          });
        }
      }
    }
  }

  const results = {
    replayedDocs: parentRows.length,
    missingPaths,
    property_daily_snapshots: await upsertRows(supabase, "property_daily_snapshots", parentRows, "id"),
    property_leads: await upsertRows(supabase, "property_leads", leadRows, "id"),
    property_events: await upsertRows(supabase, "property_events", eventRows, "id"),
    property_invoices: await upsertRows(supabase, "property_invoices", invoiceRows, "id"),
    property_availability: await upsertRows(supabase, "property_availability", availabilityRows, "id"),
  };

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error("Replay failed.");
  console.error(error);
  process.exitCode = 1;
});
