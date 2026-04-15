import { createWriteStream, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";
import { PROPERTY_CATALOG } from "../dashboard/src/propertyCatalog.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT_DIR, "migration-output", "firestore-json");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "relational-manifest.json");
const BATCH_SIZE = Number.parseInt(process.env.SUPABASE_BATCH_SIZE ?? "250", 10);
const SKIP_MANAGED_EXPORT = process.env.SKIP_MANAGED_EXPORT === "1";

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

function resolveManagedExportUri() {
  const explicitUri = process.env.FIRESTORE_EXPORT_GCS_URI;
  if (explicitUri) return explicitUri;
  const bucket = requireEnv("FIRESTORE_EXPORT_BUCKET");
  return bucket.startsWith("gs://") ? bucket : `gs://${bucket}`;
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

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function logProgress(message) {
  console.log(`[progress] ${message}`);
}

function createManifest() {
  return {
    generatedAt: new Date().toISOString(),
    projectId: process.env.FIREBASE_PROJECT_ID ?? null,
    managedExportUri: process.env.FIRESTORE_EXPORT_BUCKET ? resolveManagedExportUri() : null,
    managedExport: {
      skipped: SKIP_MANAGED_EXPORT,
      success: false,
      error: null,
    },
    sourceCollections: [],
    exportedFiles: [],
    tableCounts: {},
    failedDocuments: [],
    notes: [],
  };
}

async function ensureOutputDirectory() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function writeJsonFile(name, payload, manifest) {
  const filePath = path.join(OUTPUT_DIR, name);
  if (Array.isArray(payload)) {
    await writeJsonArrayStream(filePath, payload);
  } else {
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  }
  manifest.exportedFiles.push(filePath);
}

async function writeJsonArrayStream(filePath, payload) {
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath, { encoding: "utf8" });

    stream.on("error", reject);
    stream.on("finish", resolve);

    stream.write("[\n");

    payload.forEach((item, index) => {
      const serialized = JSON.stringify(item, null, 2)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      const suffix = index === payload.length - 1 ? "\n" : ",\n";
      stream.write(serialized);
      stream.write(suffix);
    });

    stream.write("]\n");
    stream.end();
  });
}

function createJsonArrayWriter(filePath) {
  let isFirstItem = true;

  return new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath, { encoding: "utf8" });

    stream.on("error", reject);
    stream.on("open", () => {
      stream.write("[\n");
      resolve({
        async write(item) {
          const serialized = JSON.stringify(item, null, 2)
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n");
          const prefix = isFirstItem ? "" : ",\n";
          isFirstItem = false;

          await new Promise((writeResolve, writeReject) => {
            stream.write(prefix + serialized, (error) => {
              if (error) writeReject(error);
              else writeResolve();
            });
          });
        },
        async close() {
          await new Promise((closeResolve, closeReject) => {
            stream.end("\n]\n", (error) => {
              if (error) closeReject(error);
              else closeResolve();
            });
          });
        },
      });
    });
  });
}

async function runManagedExport(manifest) {
  if (SKIP_MANAGED_EXPORT) {
    manifest.notes.push("Managed export skipped because SKIP_MANAGED_EXPORT=1.");
    return;
  }

  const exportUri = resolveManagedExportUri();
  logStep(`Triggering Firestore managed export to ${exportUri}`);

  await new Promise((resolve, reject) => {
    const child = spawn("gcloud", ["firestore", "export", exportUri, "--project", requireEnv("FIREBASE_PROJECT_ID")], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gcloud firestore export exited with code ${code}`));
      }
    });
  });

  manifest.managedExport.success = true;
}

function incrementCount(manifest, tableName, amount = 1) {
  manifest.tableCounts[tableName] = (manifest.tableCounts[tableName] ?? 0) + amount;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

async function upsertRows(supabase, table, rows, onConflict, manifest) {
  if (rows.length === 0) return;
  const dedupedRows = dedupeRowsByConflict(rows, onConflict);
  logProgress(`Upserting ${dedupedRows.length} rows into ${table}`);
  for (const chunk of chunkArray(dedupedRows, BATCH_SIZE)) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
    incrementCount(manifest, table, chunk.length);
  }
}

async function ensurePropertyStubs(supabase, propertyIds, manifest, knownPropertyIds) {
  const missingIds = [...new Set(propertyIds.map(String))].filter((propertyId) => !knownPropertyIds.has(propertyId));
  if (missingIds.length === 0) return;

  const stubRows = missingIds.map((propertyId) => ({
    id: propertyId,
    raw_data: {
      generated_stub: true,
      source: "relational_migration",
      property_id: propertyId,
    },
    firestore_path: `properties/${propertyId}`,
  }));

  await upsertRows(supabase, "properties", stubRows, "id", manifest);
  for (const propertyId of missingIds) {
    knownPropertyIds.add(propertyId);
  }
}

async function upsertByFirestorePath(supabase, table, rows, manifest) {
  for (const row of rows) {
    const { data: existing, error: selectError } = await supabase
      .from(table)
      .select("id")
      .eq("firestore_path", row.firestore_path)
      .limit(1);

    if (selectError) throw selectError;

    if (existing && existing.length > 0) {
      const { error } = await supabase.from(table).update(row).eq("id", existing[0].id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(table).insert(row);
      if (error) throw error;
    }

    incrementCount(manifest, table, 1);
  }
}

function normalizeForeignKeyPropertyId(propertyId, knownPropertyIds) {
  if (propertyId == null) return null;
  const normalized = String(propertyId);
  return knownPropertyIds.has(normalized) ? normalized : null;
}

async function migrateSyncState(db, supabase, manifest) {
  const snapshot = await db.collection("_sync_state").get();
  const docs = snapshot.docs.map((doc) => {
    const data = normalizeFirestoreValue(doc.data() ?? {});
    return {
      id: doc.id,
      active: Boolean(data.active ?? true),
      completed: Boolean(data.completed ?? false),
      run_date: toDateString(data.run_date),
      phase: data.phase ?? null,
      initiated_by: data.initiated_by ?? null,
      target_offsets: data.target_offsets ?? [],
      property_ids: data.property_ids ?? [],
      raw_start_date: toDateString(data.raw_start_date),
      raw_end_date: toDateString(data.raw_end_date),
      report_start_date: toDateString(data.report_start_date),
      report_end_date: toDateString(data.report_end_date),
      raw_day_index: data.raw_day_index ?? null,
      raw_property_index: data.raw_property_index ?? null,
      attribution_property_index: data.attribution_property_index ?? null,
      aggregate_property_index: data.aggregate_property_index ?? null,
      batch_size: data.batch_size ?? null,
      raw_batch_size: data.raw_batch_size ?? null,
      property_batch_size: data.property_batch_size ?? null,
      total_days: data.total_days ?? null,
      next_day_offset: data.next_day_offset ?? null,
      next_property_index: data.next_property_index ?? null,
      last_summary: data.last_summary ?? null,
      last_attribution_results: data.last_attribution_results ?? [],
      last_aggregate_results: data.last_aggregate_results ?? [],
      last_processed_count: data.last_processed_count ?? null,
      last_skipped_count: data.last_skipped_count ?? null,
      last_error_count: data.last_error_count ?? null,
      started_at: toIso(data.started_at),
      completed_at: toIso(data.completed_at),
      last_processed_at: toIso(data.last_processed_at),
      raw_data: data,
      firestore_path: doc.ref.path,
    };
  });

  await writeJsonFile("_sync_state.relational.json", docs, manifest);
  await upsertRows(supabase, "sync_state", docs, "id", manifest);
}

async function migrateSyncRetries(db, supabase, manifest, knownPropertyIds) {
  const snapshot = await db.collection("_sync_retries").get();
  const docs = snapshot.docs.map((doc) => {
    const data = normalizeFirestoreValue(doc.data() ?? {});
    return {
      id: doc.id,
      job_type: data.job_type ?? null,
      property_id: normalizeForeignKeyPropertyId(data.property_id, knownPropertyIds),
      date_id: toDateString(data.date_id),
      date_str: data.date_str ?? null,
      attempts: data.attempts ?? 0,
      last_error: data.last_error ?? null,
      abandoned: Boolean(data.abandoned ?? false),
      abandon_reason: data.abandon_reason ?? null,
      abandoned_at: toIso(data.abandoned_at),
      last_queued_at: toIso(data.last_queued_at),
      raw_data: data,
      firestore_path: doc.ref.path,
    };
  });

  await writeJsonFile("_sync_retries.relational.json", docs, manifest);
  await upsertRows(supabase, "sync_retries", docs, "id", manifest);
}

async function migrateSiteAudits(db, supabase, manifest) {
  const snapshot = await db.collection("site_audits").get();
  const docs = snapshot.docs.map((doc) => {
    const data = normalizeFirestoreValue(doc.data() ?? {});
    return {
      site: data.site ?? null,
      audited_at: toIso(data.timestamp),
      pages_audited: data.pages_audited ?? [],
      broken_links: data.broken_links ?? [],
      missing_meta: data.missing_meta ?? [],
      headline_optimizations: data.headline_optimizations ?? [],
      raw_data: data,
      firestore_path: doc.ref.path,
    };
  });

  await writeJsonFile("site_audits.relational.json", docs, manifest);
  await upsertByFirestorePath(supabase, "site_audits", docs, manifest);
}

async function migrateLeaseDetails(db, supabase, manifest, knownPropertyIds) {
  const snapshot = await db.collection("lease_details").get();
  const docs = snapshot.docs.map((doc) => {
    const data = normalizeFirestoreValue(doc.data() ?? {});
    return {
      id: doc.id,
      property_id: normalizeForeignKeyPropertyId(data.property_id, knownPropertyIds),
      details: data.details ?? {},
      fetched_at: toIso(data.timestamp),
      firestore_path: doc.ref.path,
    };
  });

  await writeJsonFile("lease_details.relational.json", docs, manifest);
  await upsertRows(supabase, "lease_details", docs, "id", manifest);
}

async function migrateMarketingOpportunities(db, supabase, manifest) {
  const snapshot = await db.collection("marketing_opportunities").get();
  const docs = snapshot.docs.map((doc) => {
    const data = normalizeFirestoreValue(doc.data() ?? {});
    return {
      source: data.source ?? null,
      query: data.query ?? null,
      title: data.title ?? null,
      url: data.url ?? null,
      event_timestamp: toIso(data.timestamp),
      scraped_at: toIso(data.scraped_at),
      raw_data: data,
      firestore_path: doc.ref.path,
    };
  });

  await writeJsonFile("marketing_opportunities.relational.json", docs, manifest);
  await upsertByFirestorePath(supabase, "marketing_opportunities", docs, manifest);
}

async function migratePropertyData(db, supabase, manifest, knownPropertyIds) {
  logStep("Migrating property_data snapshots and nested collections");
  const snapshot = await db.collection("property_data").get();
  const exportPath = path.join(OUTPUT_DIR, "property_data.relational.json");
  const rawWriter = await createJsonArrayWriter(exportPath);
  manifest.exportedFiles.push(exportPath);
  const parentRows = [];
  const leadRows = [];
  const eventRows = [];
  const invoiceRows = [];
  const availabilityRows = [];
  const snapshotLeaseRows = [];
  const pendingPropertyIds = new Set();

  let processedDocs = 0;
  let flushedDocs = 0;

  async function flushPropertyDataBatches() {
    const referencedPropertyIds = [...pendingPropertyIds];
    await ensurePropertyStubs(supabase, referencedPropertyIds, manifest, knownPropertyIds);
    pendingPropertyIds.clear();

    await upsertRows(supabase, "property_daily_snapshots", parentRows, "id", manifest);
    await upsertRows(supabase, "property_leads", leadRows, "id", manifest);
    await upsertRows(supabase, "property_events", eventRows, "id", manifest);
    await upsertRows(supabase, "property_invoices", invoiceRows, "id", manifest);
    await upsertRows(supabase, "property_availability", availabilityRows, "id", manifest);
    await upsertRows(supabase, "property_snapshot_leases", snapshotLeaseRows, "id", manifest);

    flushedDocs += parentRows.length;
    parentRows.length = 0;
    leadRows.length = 0;
    eventRows.length = 0;
    invoiceRows.length = 0;
    availabilityRows.length = 0;
    snapshotLeaseRows.length = 0;

    if (flushedDocs > 0) {
      logProgress(`Flushed ${flushedDocs} property_data documents into Supabase batches`);
    }
  }

  try {
    for (const doc of snapshot.docs) {
      try {
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

        if (propertyId) {
          pendingPropertyIds.add(propertyId);
        }

        const rawDoc = { id: doc.id, path: doc.ref.path, data, subcollections: {} };

        for (const subcollection of await doc.ref.listCollections()) {
          const nestedSnapshot = await subcollection.get();
          rawDoc.subcollections[subcollection.id] = nestedSnapshot.docs.map((nested) => ({
            id: nested.id,
            path: nested.ref.path,
            data: normalizeFirestoreValue(nested.data() ?? {}),
          }));

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
                lead_id:
                  payload.leadId ?? payload.leadID ?? payload.prospectId ?? payload.prospectID ?? payload.id ?? null,
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
                invoice_id:
                  payload.invoiceId ??
                  payload.invoiceID ??
                  payload.arInvoiceId ??
                  payload.referenceNumber ??
                  payload.id ??
                  null,
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
            } else if (subcollection.id === "leases") {
              snapshotLeaseRows.push({
                id: nestedPath,
                property_snapshot_id: doc.id,
                property_id: propertyId,
                activity_date: activityDate,
                lease_id: nested.id,
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
                firestore_path: nestedPath,
              });
            }
          }
        }

        await rawWriter.write(rawDoc);
        processedDocs += 1;
        if (processedDocs % 100 === 0) {
          logProgress(`Processed ${processedDocs} property_data documents`);
        }

        if (parentRows.length >= BATCH_SIZE) {
          await flushPropertyDataBatches();
        }
      } catch (error) {
        manifest.failedDocuments.push({ path: doc.ref.path, error: error.message });
      }
    }

    if (parentRows.length > 0) {
      await flushPropertyDataBatches();
    }
  } finally {
    await rawWriter.close();
  }
}

async function migrateProperties(db, supabase, manifest) {
  logStep("Migrating properties and nested property subcollections");
  const snapshot = await db.collection("properties").get();
  const propertyRowMap = new Map(
    PROPERTY_CATALOG.map((property) => [
      String(property.propertyId),
      {
        id: String(property.propertyId),
        name: property.name ?? null,
        city: property.city ?? null,
        state: property.state ?? null,
        google_ads_id: property.googleAdsId ?? null,
        google_analytics_id: property.googleAnalyticsId ?? null,
        meta_ads_account_id: property.metaAdsAccountId ?? null,
        meta_ads_match_terms: property.metaAdsMatchTerms ?? [],
        raw_data: property,
        firestore_path: `properties/${property.propertyId}`,
      },
    ]),
  );
  const specialsRows = [];
  const availabilitySnapshotRows = [];
  const leaseRows = [];
  const roiRows = [];
  const analyticsRows = [];
  const websiteManagerRows = [];
  const reportingLayoutRows = [];
  const rawDocs = [];

  for (const doc of snapshot.docs) {
    try {
      const data = normalizeFirestoreValue(doc.data() ?? {});
      const propertyId = doc.id;

      propertyRowMap.set(propertyId, {
        id: propertyId,
        name: data.name ?? data.propertyName ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        portfolio: data.portfolio ?? null,
        org_slug: data.org_slug ?? data.orgSlug ?? null,
        google_ads_id: data.googleAdsId ?? null,
        google_analytics_id: data.googleAnalyticsId ?? null,
        meta_ads_account_id: data.metaAdsAccountId ?? null,
        meta_ads_match_terms: data.metaAdsMatchTerms ?? [],
        opiniion_location_id: data.opiniionLocationId ?? data.reputationLocationId ?? null,
        opiniion_location_name: data.opiniionLocationName ?? data.reputationLocationName ?? null,
        raw_data: data,
        firestore_path: doc.ref.path,
      });
    } catch (error) {
      manifest.failedDocuments.push({ path: doc.ref.path, error: error.message });
    }
  }

  let processedProperties = 0;

  for (const propertyId of propertyRowMap.keys()) {
    try {
      const propertyRef = db.collection("properties").doc(propertyId);
      const propertyData = propertyRowMap.get(propertyId)?.raw_data ?? {};
      const rawDoc = { id: propertyId, path: propertyRef.path, data: propertyData, subcollections: {} };

      for (const subcollection of await propertyRef.listCollections()) {
        const nestedSnapshot = await subcollection.get();
        rawDoc.subcollections[subcollection.id] = nestedSnapshot.docs.map((nested) => ({
          id: nested.id,
          path: nested.ref.path,
          data: normalizeFirestoreValue(nested.data() ?? {}),
        }));

        for (const nested of nestedSnapshot.docs) {
          const nestedData = normalizeFirestoreValue(nested.data() ?? {});
          const nestedPath = nested.ref.path;

          if (subcollection.id === "specials" && nested.id === "current") {
            specialsRows.push({
              property_id: propertyId,
              special_count: nestedData.special_count ?? 0,
              specials_hash: nestedData.specials_hash ?? null,
              specials: nestedData.specials ?? [],
              raw_result: nestedData.raw_result ?? {},
              portfolio: nestedData.portfolio ?? null,
              org_slug: nestedData.org_slug ?? null,
              last_changed_at: toIso(nestedData.last_changed_at),
              last_synced_at: toIso(nestedData.last_synced_at),
              firestore_path: nestedPath,
            });
          } else if (subcollection.id === "availability_pricing" && nested.id === "current") {
            availabilitySnapshotRows.push({
              property_id: propertyId,
              floorplan_count: nestedData.floorplan_count ?? 0,
              unit_count: nestedData.unit_count ?? 0,
              availability_url: nestedData.availability_url ?? null,
              snapshot_hash: nestedData.snapshot_hash ?? null,
              property_payload: nestedData.property ?? {},
              floorplans: nestedData.floorplans ?? [],
              units: nestedData.units ?? [],
              raw_result: nestedData.raw_result ?? {},
              portfolio: nestedData.portfolio ?? null,
              org_slug: nestedData.org_slug ?? null,
              last_changed_at: toIso(nestedData.last_changed_at),
              last_synced_at: toIso(nestedData.last_synced_at),
              firestore_path: nestedPath,
            });
          } else if (subcollection.id === "leases") {
            leaseRows.push({
              id: nestedPath,
              property_id: propertyId,
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
              firestore_path: nestedPath,
            });
          } else if (subcollection.id === "roi_daily") {
            const totals = nestedData.totals ?? {};
            roiRows.push({
              id: nestedPath,
              property_id: propertyId,
              activity_date: toDateString(nestedData.date ?? nestedData.activity_date),
              attributed_leases: totals.attributed_leases ?? 0,
              unattributed_leases: totals.unattributed_leases ?? 0,
              gross_lease_value: toNumber(totals.gross_lease_value) ?? 0,
              net_effective_revenue: toNumber(totals.net_effective_revenue) ?? 0,
              concession_total: toNumber(totals.concession_total) ?? 0,
              marketing_spend: toNumber(totals.marketing_spend) ?? 0,
              performance_marketing_spend: toNumber(totals.performance_marketing_spend) ?? 0,
              roi: toNumber(totals.roi),
              source_metrics: nestedData.source_metrics ?? [],
              invoice_channels: nestedData.invoice_channels ?? [],
              raw_data: nestedData,
              last_aggregated_at: toIso(nestedData.last_aggregated_at),
              firestore_path: nestedPath,
            });
          } else if (subcollection.id === "analytics") {
            analyticsRows.push({
              property_id: propertyId,
              snapshot_type: nested.id,
              fetched_at: toIso(nestedData.fetchedAt),
              payload: nestedData,
              firestore_path: nestedPath,
            });
          } else if (subcollection.id === "website_manager" && nested.id === "current") {
            websiteManagerRows.push({
              property_id: propertyId,
              property_name: nestedData.propertyName ?? null,
              platform: nestedData.platform ?? "unknown",
              website_url: nestedData.websiteUrl ?? null,
              wordpress_site_key: nestedData.wordpressSiteKey ?? null,
              notes: nestedData.notes ?? null,
              editable: Boolean(nestedData.editable ?? false),
              content: nestedData.content ?? {},
              firestore_path: nestedPath,
            });
          } else if (subcollection.id === "reporting_layout" && nested.id === "current") {
            reportingLayoutRows.push({
              property_id: propertyId,
              property_name: nestedData.propertyName ?? null,
              panel_order: nestedData.panelOrder ?? [],
              hidden_panel_ids: nestedData.hiddenPanelIds ?? [],
              firestore_path: nestedPath,
            });
          }
        }
      }

      rawDocs.push(rawDoc);
      processedProperties += 1;
      if (processedProperties % 25 === 0) {
        logProgress(`Processed ${processedProperties} property records/subcollection trees`);
      }
    } catch (error) {
      manifest.failedDocuments.push({ path: `properties/${propertyId}`, error: error.message });
    }
  }

  const propertyRows = [...propertyRowMap.values()];
  await writeJsonFile("properties.relational.json", rawDocs, manifest);
  await upsertRows(supabase, "properties", propertyRows, "id", manifest);
  await upsertRows(supabase, "property_specials_current", specialsRows, "property_id", manifest);
  await upsertRows(supabase, "property_availability_snapshots", availabilitySnapshotRows, "property_id", manifest);
  await upsertRows(supabase, "property_leases", leaseRows, "id", manifest);
  await upsertRows(supabase, "property_roi_daily", roiRows, "id", manifest);
  await upsertRows(supabase, "property_analytics_snapshots", analyticsRows, "property_id,snapshot_type", manifest);
  await upsertRows(supabase, "property_website_manager_current", websiteManagerRows, "property_id", manifest);
  await upsertRows(supabase, "property_reporting_layout_current", reportingLayoutRows, "property_id", manifest);

  return new Set(propertyRows.map((row) => row.id));
}

async function migrateCollectionIfExists(db, name, callback, manifest) {
  if (manifest.sourceCollections.includes(name)) {
    await callback();
  }
}

async function writeManifest(manifest) {
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

async function main() {
  await ensureOutputDirectory();
  const manifest = createManifest();

  try {
    await runManagedExport(manifest);
  } catch (error) {
    manifest.managedExport.error = error.message;
    manifest.notes.push(
      "Managed export failed. Recursive Firestore export and relational load may still proceed if direct Firestore access works.",
    );
  }

  const db = initializeFirebaseAdmin();
  const supabase = createSupabase();
  manifest.sourceCollections = (await db.listCollections()).map((collection) => collection.id).sort();
  logProgress(`Top-level collections: ${manifest.sourceCollections.join(", ")}`);

  const knownPropertyIds = manifest.sourceCollections.includes("properties")
    ? await migrateProperties(db, supabase, manifest)
    : new Set();

  await migrateCollectionIfExists(db, "_sync_state", () => {
    logStep("Migrating _sync_state");
    return migrateSyncState(db, supabase, manifest);
  }, manifest);
  await migrateCollectionIfExists(
    db,
    "_sync_retries",
    () => {
      logStep("Migrating _sync_retries");
      return migrateSyncRetries(db, supabase, manifest, knownPropertyIds);
    },
    manifest,
  );
  await migrateCollectionIfExists(
    db,
    "marketing_opportunities",
    () => {
      logStep("Migrating marketing_opportunities");
      return migrateMarketingOpportunities(db, supabase, manifest);
    },
    manifest,
  );
  await migrateCollectionIfExists(db, "site_audits", () => {
    logStep("Migrating site_audits");
    return migrateSiteAudits(db, supabase, manifest);
  }, manifest);
  await migrateCollectionIfExists(
    db,
    "lease_details",
    () => {
      logStep("Migrating lease_details");
      return migrateLeaseDetails(db, supabase, manifest, knownPropertyIds);
    },
    manifest,
  );
  await migrateCollectionIfExists(
    db,
    "property_data",
    () => migratePropertyData(db, supabase, manifest, knownPropertyIds),
    manifest,
  );

  await writeManifest(manifest);
  logStep("Relational Firestore to Supabase migration finished");
}

main().catch(async (error) => {
  console.error("Relational migration failed.");
  console.error(error);
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(
      MANIFEST_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          fatalError: error.message,
        },
        null,
        2,
      ),
    );
  } catch {
    // Best effort only.
  }
  process.exitCode = 1;
});
