# Staging Cutover Plan

This plan is intentionally conservative. It keeps Firebase/Firestore live until the replacement stack has been validated end to end.

## Recommended order

1. GitHub as source of truth
2. Supabase schema and data migration
3. Render backend deployment
4. Vercel frontend deployment
5. staging validation
6. final cutover

## Phase 1. GitHub as source of truth

- Push the repo to GitHub
- Treat GitHub as the deployment source for Vercel and Render
- Keep Firebase deployment files in the repo during transition

## Phase 2. Supabase schema and data migration

- Apply `supabase/firestore_first_pass_schema.sql`
- Run the Firestore export/migration flow into staging
- Compare Firestore and Supabase row counts
- Validate representative property/day records

## Phase 3. Render backend deployment

- Stand up Render services without replacing production Firebase endpoints yet
- Recreate API endpoints incrementally
- Recreate scheduled jobs as Render cron jobs only after job behavior is validated
- Keep Firebase Functions as the production source of truth until Render is proven

## Phase 4. Vercel frontend deployment

- Deploy the existing `dashboard/` app on Vercel
- Keep Firebase-based reads active initially
- Use environment overrides to test staging API endpoints later
- Avoid production DNS or traffic changes until validation is complete

## Phase 5. Staging validation

Validate all of the following before cutover:

- frontend builds and renders on Vercel
- Firebase-backed frontend still behaves correctly
- staging backend endpoints return expected payloads
- Supabase data matches expected Firestore source data
- scheduled jobs run successfully in staging
- analytics endpoints return expected results
- ROI pipeline status and backfill behavior are understood
- retry queue behavior is understood
- admin/content-editing flows still work or have a staged replacement plan

## Phase 6. Final cutover

- choose a controlled cutover window
- freeze or carefully coordinate writes if needed
- run a final Firestore backup/export
- run a final staging-to-production migration pass
- switch frontend endpoints and/or data source intentionally
- monitor logs, row counts, and customer-visible behavior

## Rollback guidance

If any part of staging or cutover fails:

- keep Firebase/Firestore as the fallback source of truth
- revert frontend environment variables to Firebase-backed endpoints
- pause Render cron jobs if they produce inconsistent data
- rerun migration validation before trying again

The key rollback rule is simple:

Do not remove or disable the Firebase path until the replacement stack is verified under real staging conditions.

## Pre-cutover checklist

- GitHub repo is canonical and complete
- Supabase schema is applied
- Firestore backup/export has been run successfully
- staging Supabase data has been validated
- Render deployment plan is finalized
- Vercel deployment is working
- environment variables are separated correctly
- service role keys and other secrets are not exposed publicly
- rollback plan is written and understood
