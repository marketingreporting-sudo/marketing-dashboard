# Data Migration Flow

This document preserves the current Firestore-to-Supabase migration plan while keeping production Firebase logic untouched.

## Scope

This repo already contains:

- Firestore export + recursive dump utility in `scripts/firestore-to-supabase.mjs`
- relational Firestore-to-Supabase loader in `scripts/firestore-to-supabase-relational.mjs`
- first-pass relational schema in `supabase/firestore_first_pass_schema.sql`
- schema mapping notes in `docs/supabase-first-pass-schema.md`

These assets remain intact and are staging-only until cutover.

The current staged validation state is summarized in `docs/migration-validation-report.md`.

## Backup and export flow

1. Confirm the Supabase schema exists or is ready to apply
2. Authenticate `gcloud`
3. Generate or confirm a Firebase service account with Firestore read access
4. Set the migration utility environment variables in the root `.env`
5. Run `npm install` at the repo root
6. Run `npm run migrate:firestore-to-supabase`
7. For the relational target, run `npm run migrate:firestore-to-supabase:relational`

The migration utility will:

- trigger `gcloud firestore export`
- recursively read Firestore collections and subcollections
- normalize Firestore-specific types into JSON-safe values
- write local JSON artifacts under `migration-output/firestore-json/`
- write a manifest file with collection counts, paths, and failures
- upsert collection data into Supabase based on the utility's current behavior

The relational loader will:

- read Firestore directly with the Admin SDK
- map top-level collections and nested subcollections into the first-pass Supabase schema
- write a separate relational manifest file
- optionally skip the managed export step with `SKIP_MANAGED_EXPORT=1` when bucket IAM is not ready yet

## Expected Supabase dependencies

- a Supabase project already created
- the first-pass schema applied from `supabase/firestore_first_pass_schema.sql`, or an approved equivalent
- backend access to:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Safe order of operations

1. Firestore managed export backup
2. Recursive Firestore JSON export
3. Validate manifest output
4. Load into staging Supabase
5. Validate row counts and sample records
6. Only then begin backend runtime migration work

## Current limitation

The current migration utility preserves the original one-table-per-top-level-collection flow. That is useful for staging backups and early landing-zone imports, but it is not yet the final relational loader for the full first-pass schema.

Recommended next step later:

- adapt the migration utility to write directly into the staged Supabase relational tables

Do not make that runtime switch until staging validation is complete.

## Backend migration flow

The backend should move in stages:

1. keep Firebase Functions as the live runtime
2. stand up a Render-native API layer in staging
3. move Firestore reads and writes behind compatibility adapters or targeted rewrites
4. recreate scheduled Firebase jobs as Render cron jobs
5. validate parity between Firebase-backed outputs and Render-backed outputs
6. switch runtime only after staging proves stable

Safe sequencing matters more than speed here. The backend should not be cut over until:

- Supabase staging data is validated
- the Render API surface is defined
- the cron mapping is reviewed
- endpoint responses are tested against current frontend expectations

## Frontend cutover flow

The frontend should also move in stages:

1. deploy the existing `dashboard/` app to Vercel
2. keep Firebase client reads in place initially
3. use `VITE_*` endpoint overrides to test Render APIs in staging
4. introduce Supabase or new backend data paths only after the Render layer is stable
5. switch production frontend configuration only after validation

The important rule is:

The first Vercel deployment is a hosting migration, not a data-source migration.
