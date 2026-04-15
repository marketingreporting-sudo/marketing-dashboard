import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "migration-output", "firestore-json");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
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

function resolveManagedExportUri() {
  const explicitUri = process.env.FIRESTORE_EXPORT_GCS_URI;
  if (explicitUri) {
    return explicitUri;
  }

  const bucket = requireEnv("FIRESTORE_EXPORT_BUCKET");
  return bucket.startsWith("gs://") ? bucket : `gs://${bucket}`;
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
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function ensureFiniteBatchSize(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`SUPABASE_BATCH_SIZE must be a positive integer. Received: ${value}`);
  }
}

function normalizeFirestoreValue(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFirestoreValue(item));
  }

  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof admin.firestore.GeoPoint) {
    return {
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }

  if (value instanceof admin.firestore.DocumentReference) {
    return value.path;
  }

  if (value instanceof admin.firestore.Bytes) {
    return value.toBase64();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeFirestoreValue(nestedValue),
      ]),
    );
  }

  return value;
}

function createManifest() {
  return {
    generatedAt: new Date().toISOString(),
    managedExportUri: resolveManagedExportUri(),
    topLevelCollections: [],
    collections: {},
    rowCountsByCollection: {},
    subcollectionPaths: [],
    failedDocuments: [],
    managedExport: {
      success: false,
      startedAt: null,
      completedAt: null,
      error: null,
    },
    supabase: {
      batchSize: BATCH_SIZE,
      tables: {},
    },
  };
}

async function runManagedExport(exportUri, projectId) {
  logStep(`Triggering Firestore managed export to ${exportUri}`);

  return new Promise((resolve, reject) => {
    const args = ["firestore", "export", exportUri];
    if (projectId) {
      args.push("--project", projectId);
    }

    const child = spawn("gcloud", args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to start gcloud: ${error.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`gcloud firestore export exited with code ${code}`));
    });
  });
}

async function ensureOutputDirectory() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

function getCollectionStats(manifest, collectionPath) {
  if (!manifest.collections[collectionPath]) {
    manifest.collections[collectionPath] = {
      documentCount: 0,
      documentsWithSubcollections: 0,
    };
    manifest.rowCountsByCollection[collectionPath] = 0;
  }

  return manifest.collections[collectionPath];
}

function recordFailedDocument(manifest, documentPath, error) {
  manifest.failedDocuments.push({
    path: documentPath,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function exportDocumentTree(documentSnapshot, manifest) {
  const documentPath = documentSnapshot.ref.path;
  const collectionPath = documentSnapshot.ref.parent.path;
  const collectionStats = getCollectionStats(manifest, collectionPath);

  collectionStats.documentCount += 1;
  manifest.rowCountsByCollection[collectionPath] += 1;

  const documentNode = {
    id: documentSnapshot.id,
    path: documentPath,
    data: normalizeFirestoreValue(documentSnapshot.data() ?? {}),
    subcollections: {},
  };

  try {
    const nestedCollections = await documentSnapshot.ref.listCollections();

    if (nestedCollections.length > 0) {
      collectionStats.documentsWithSubcollections += 1;
    }

    for (const nestedCollection of nestedCollections) {
      manifest.subcollectionPaths.push(nestedCollection.path);
      const nestedStats = getCollectionStats(manifest, nestedCollection.path);
      nestedStats.parentDocumentPath = documentPath;

      const nestedSnapshots = await nestedCollection.get();
      documentNode.subcollections[nestedCollection.id] = [];

      for (const nestedDocument of nestedSnapshots.docs) {
        try {
          const nestedNode = await exportDocumentTree(nestedDocument, manifest);
          documentNode.subcollections[nestedCollection.id].push(nestedNode);
        } catch (error) {
          console.error(`Failed to export nested document ${nestedDocument.ref.path}`, error);
        }
      }
    }

    return documentNode;
  } catch (error) {
    recordFailedDocument(manifest, documentPath, error);
    throw error;
  }
}

async function exportFirestoreJson(firestore, manifest) {
  logStep("Recursively exporting Firestore to local JSON");

  const topLevelCollections = await firestore.listCollections();
  manifest.topLevelCollections = topLevelCollections.map((collection) => collection.id);

  const topLevelPayloads = [];

  for (const collection of topLevelCollections) {
    console.log(`Exporting top-level collection: ${collection.id}`);
    const stats = getCollectionStats(manifest, collection.path);
    const snapshot = await collection.get();
    const documents = [];
    const supabaseRows = [];

    for (const documentSnapshot of snapshot.docs) {
      try {
        const documentNode = await exportDocumentTree(documentSnapshot, manifest);
        documents.push(documentNode);
        supabaseRows.push({
          id: documentSnapshot.id,
          data: documentNode.data,
          firestore_path: documentSnapshot.ref.path,
          updated_at: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`Failed to export document ${documentSnapshot.ref.path}`, error);
      }
    }

    const collectionPayload = {
      collection: collection.id,
      path: collection.path,
      documentCount: stats.documentCount,
      exportedAt: new Date().toISOString(),
      documents,
    };

    const collectionFilePath = path.join(OUTPUT_DIR, `${collection.id}.json`);
    await fs.writeFile(collectionFilePath, JSON.stringify(collectionPayload, null, 2));

    topLevelPayloads.push({
      collection: collection.id,
      filePath: collectionFilePath,
      rows: supabaseRows,
    });
  }

  manifest.subcollectionPaths = [...new Set(manifest.subcollectionPaths)].sort();
  return topLevelPayloads;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function upsertIntoSupabase(supabase, topLevelPayloads, manifest) {
  logStep("Upserting top-level Firestore collections into Supabase");

  for (const payload of topLevelPayloads) {
    const tableName = payload.collection;
    const rows = payload.rows;
    manifest.supabase.tables[tableName] = {
      attempted: rows.length,
      upserted: 0,
      failedBatches: [],
    };

    if (rows.length === 0) {
      console.log(`Skipping Supabase upsert for ${tableName}: no rows found`);
      continue;
    }

    const chunks = chunkArray(rows, BATCH_SIZE);
    console.log(
      `Upserting ${rows.length} rows into Supabase table "${tableName}" in ${chunks.length} batches`,
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const { error } = await supabase
        .from(tableName)
        .upsert(chunk, { onConflict: "id", ignoreDuplicates: false });

      if (error) {
        const failure = {
          batchNumber: index + 1,
          rowCount: chunk.length,
          error: error.message,
        };

        manifest.supabase.tables[tableName].failedBatches.push(failure);
        console.error(
          `Supabase upsert failed for ${tableName} batch ${index + 1}/${chunks.length}`,
          error,
        );
        continue;
      }

      manifest.supabase.tables[tableName].upserted += chunk.length;
      console.log(`Finished batch ${index + 1}/${chunks.length} for ${tableName}`);
    }
  }
}

async function writeManifest(manifest) {
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${MANIFEST_PATH}`);
}

async function main() {
  ensureFiniteBatchSize(BATCH_SIZE);
  await ensureOutputDirectory();

  const manifest = createManifest();
  const exportUri = resolveManagedExportUri();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;

  try {
    manifest.managedExport.startedAt = new Date().toISOString();
    await runManagedExport(exportUri, projectId);
    manifest.managedExport.success = true;
    manifest.managedExport.completedAt = new Date().toISOString();
  } catch (error) {
    manifest.managedExport.completedAt = new Date().toISOString();
    manifest.managedExport.error = error instanceof Error ? error.message : String(error);
    await writeManifest(manifest);
    throw error;
  }

  const firestore = initializeFirebaseAdmin();
  const supabase = createSupabase();

  try {
    const topLevelPayloads = await exportFirestoreJson(firestore, manifest);
    await upsertIntoSupabase(supabase, topLevelPayloads, manifest);
  } finally {
    await writeManifest(manifest);
  }

  logStep("Firestore to Supabase migration completed");
}

main().catch((error) => {
  console.error("\nMigration failed.");
  console.error(error);
  process.exitCode = 1;
});
