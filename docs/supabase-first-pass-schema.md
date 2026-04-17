# Supabase First-Pass Schema

This document maps the current Firestore model in this repo to a practical Supabase/Postgres schema for the first migration.

## Goal

Move off Firestore without forcing a risky full rewrite of every data shape at once.

The recommended first pass is:

1. Preserve source payloads in `jsonb`
2. Extract the fields the current dashboard and backend already query
3. Replace Firestore subcollections with relational tables
4. Keep per-property singleton documents as one-row tables keyed by `property_id`

## Why this shape

The current app uses Firestore in two different ways:

- as a raw operational store for Entrata sync output under `property_data/{property_id}_{date}`
- as a cache/config store for per-property dashboards, analytics snapshots, specials, pricing, ROI, and admin content

If we try to mirror Firestore exactly in Postgres, we will carry document-model complexity forward. If we over-normalize immediately, migration speed will slow down. The schema in [supabase/firestore_first_pass_schema.sql](/Users/steele/Desktop/Data Analysis/supabase/firestore_first_pass_schema.sql) splits the difference.

## Firestore to Supabase mapping

### Top-level Firestore collections

| Firestore path | Supabase table | Notes |
| --- | --- | --- |
| `properties/{propertyId}` | `properties` | Canonical property row |
| `property_data/{propertyId_date}` | `property_daily_snapshots` | One row per property/day |
| `site_audits/{docId}` | `site_audits` | Stored mostly as JSON payloads |
| `marketing_opportunities/{docId}` | `marketing_opportunities` | Scraped opportunities feed |
| `_sync_state/{name}` | `sync_state` | Background job state |
| `_sync_retries/{job_property_date}` | `sync_retries` | Retry queue |
| `lease_details/{leaseId}` | `lease_details` | Lease detail fetch cache |

### Firestore subcollections under `property_data/{propertyId_date}`

| Firestore path | Supabase table |
| --- | --- |
| `property_data/{id}/leads/{leadDoc}` | `property_leads` |
| `property_data/{id}/events/{eventDoc}` | `property_events` |
| `property_data/{id}/invoices/{invoiceDoc}` | `property_invoices` |
| `property_data/{id}/availability/{availabilityDoc}` | `property_availability` |

### Firestore subcollections under `properties/{propertyId}`

| Firestore path | Supabase table | Storage model |
| --- | --- | --- |
| `specials/current` | `property_specials_current` | one row per property |
| `availability_pricing/current` | `property_availability_snapshots` | one row per property |
| `leases/{leaseId}` | `property_leases` | one row per lease |
| `roi_daily/{yyyy-mm-dd}` | `property_roi_daily` | one row per property/day |
| `analytics/ga4_dashboard` | `property_analytics_snapshots` | `snapshot_type = 'ga4_dashboard'` |
| `analytics/google_ads_dashboard` | `property_analytics_snapshots` | `snapshot_type = 'google_ads_dashboard'` |
| `analytics/meta_ads_dashboard` | `property_analytics_snapshots` | `snapshot_type = 'meta_ads_dashboard'` |
| `analytics/reputation_dashboard` | `property_analytics_snapshots` | `snapshot_type = 'reputation_dashboard'` |
| `website_manager/current` | `property_website_manager_current` | one row per property |
| `reporting_layout/current` | `property_reporting_layout_current` | one row per property |

## What the codebase currently depends on

### Dashboard reads

The frontend reads:

- `property_data` filtered by `activity_date`, then loads nested `leads`, `events`, and `invoices`
- `properties/{propertyId}/specials/current`
- `properties/{propertyId}/availability_pricing/current`
- `properties/{propertyId}/roi_daily`
- `properties/{propertyId}/analytics/*`
- `properties/{propertyId}/website_manager/current`
- `properties/{propertyId}/reporting_layout/current`

That is why the first-pass schema preserves:

- `activity_date` indexed on daily fact tables
- per-property singleton tables
- raw payloads in `jsonb`

### Backend writes

The Python backend writes:

- daily Entrata sync output into `property_data`
- normalized leases into `properties/{propertyId}/leases`
- aggregated ROI into `properties/{propertyId}/roi_daily`
- job state into `_sync_state` and `_sync_retries`
- cached analytics snapshots into `properties/{propertyId}/analytics`

This makes `property_daily_snapshots`, `property_leases`, `property_roi_daily`, `sync_state`, and `sync_retries` the core Render migration targets.

## Recommended migration order

1. Create the Supabase schema from `supabase/firestore_first_pass_schema.sql`
2. Load top-level `properties`
3. Load `property_daily_snapshots`
4. Load `property_leads`, `property_events`, `property_invoices`, and `property_availability`
5. Load per-property singleton tables:
   - `property_specials_current`
   - `property_availability_snapshots`
   - `property_analytics_snapshots`
   - `property_website_manager_current`
   - `property_reporting_layout_current`
6. Load `property_leases` and `property_roi_daily`
7. Load operational tables:
   - `sync_state`
   - `sync_retries`
   - `lease_details`
   - `site_audits`
   - `marketing_opportunities`

## What to keep as JSONB on purpose

These payloads are still variable enough that JSONB is the right first stop:

- raw Entrata lead/event/invoice/availability documents
- specials payloads
- availability pricing snapshots
- analytics dashboard payloads
- site audits
- marketing opportunities
- sync state and retry metadata

This keeps the migration moving while still giving you indexed relational columns for the fields your code already filters and joins on.

## Likely second-pass normalization later

After the cutover to Supabase/Render/Vercel is stable, I’d expect a second pass to:

- turn `property_analytics_snapshots.payload` into smaller analytics fact tables if trend history matters
- split `property_specials_current.specials` into one row per special if the team wants reporting on specials
- split `property_availability_snapshots.floorplans` and `units` into dedicated snapshot history tables if price change history matters
- move some dashboard reads to materialized views or API endpoints rather than frontend fan-out queries

## Immediate next step after schema

The next best move is to update the Firestore migration utility so it writes into these tables instead of generic one-table-per-collection JSON storage. That gives you a working data landing zone for Render and a much easier frontend migration after that.

## Auth and access model

The frontend now expects a second SQL pass for authz:

- [supabase/auth_access_model.sql](/Users/steele/Desktop/Data%20Analysis/supabase/auth_access_model.sql)

That script adds:

- `profiles`
- `app_roles`
- `role_permissions`
- `property_memberships`
- helper functions for property and permission checks
- RLS policies for `properties` and the current property-scoped dashboard tables

The intended workflow is:

1. Supabase Auth creates the user.
2. The profile trigger creates `public.profiles`.
3. An admin assigns one or more `property_memberships`.
4. The dashboard loads only the properties and tabs allowed by the user’s role set.
