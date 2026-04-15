# Migration Validation Report

This report captures the current staged Firestore-to-Supabase migration status for the repo's first-pass and second-pass migration work. It is a staging validation artifact only and does not indicate production cutover.

## Validation summary

The migration work now covers:

- top-level operational collections
- `property_data` parent snapshots
- `property_data` nested `leads`, `events`, `invoices`, and `availability`
- direct property-level `leases`
- direct property-level `roi_daily`
- second-pass snapshot-scoped leases from `property_data/{snapshotId}/leases/{leaseId}`

## Fully migrated and validated

The following datasets have been matched against Firestore source counts for the paths they are intended to represent:

| Firestore source | Supabase target | Status |
| --- | --- | --- |
| `_sync_state` | `sync_state` | validated |
| `_sync_retries` | `sync_retries` | validated |
| `marketing_opportunities` | `marketing_opportunities` | validated |
| `site_audits` | `site_audits` | validated |
| `property_data/{snapshotId}` | `property_daily_snapshots` | validated |
| `property_data/{snapshotId}/leads/{leadId}` | `property_leads` | validated |
| `property_data/{snapshotId}/events/{eventId}` | `property_events` | validated |
| `property_data/{snapshotId}/invoices/{invoiceId}` | `property_invoices` | validated |
| `property_data/{snapshotId}/availability/{unitId}` | `property_availability` | validated at zero rows |
| `properties/{propertyId}/roi_daily/{date}` | `property_roi_daily` | validated |
| `property_data/{snapshotId}/leases/{leaseId}` | `property_snapshot_leases` | validated |

## Intentionally scoped in the first-pass schema

The first-pass schema intentionally focuses on the data families needed for a controlled staging migration:

- `properties`
- `property_daily_snapshots`
- `property_leads`
- `property_events`
- `property_invoices`
- `property_availability`
- `property_specials_current`
- `property_availability_snapshots`
- `property_leases`
- `property_roi_daily`
- `property_analytics_snapshots`
- `property_website_manager_current`
- `property_reporting_layout_current`
- `sync_state`
- `sync_retries`
- `lease_details`
- `site_audits`
- `marketing_opportunities`

This scope does not attempt to flatten every Firestore collection-group into a single relational table. It prefers:

- direct property-level current data in dedicated property tables
- `property_data` snapshot-scoped data in snapshot-linked tables
- operational Firebase data in separate operational tables

## Lease modeling outcome

The lease inventory produced two distinct Firestore families:

1. `properties/{propertyId}/leases/{leaseId}`
2. `property_data/{snapshotId}/leases/{leaseId}`

The schema now treats these as different datasets:

- `property_leases`
  - intended for direct property-level lease records
- `property_snapshot_leases`
  - intended for snapshot-scoped lease records under `property_data`

This separation avoids mixing current property lease records with historical daily snapshot lease records.

## Remaining nuance

The main remaining lease nuance is:

- Firestore inventory found `897` docs under direct `properties/{propertyId}/leases/{leaseId}`
- the current `property_leases` table is still around `894` rows

That suggests a small direct-path lease delta remains to be reviewed separately. The much larger historical lease population is now accounted for by `property_snapshot_leases`, not by `property_leases`.

## Recommended next staging step

The next safe runtime step is a read-only staging integration:

1. expose a Supabase-backed validation endpoint in the Render adapter
2. compare its output to the validation report and live Firestore counts
3. choose one low-risk backend read path to move to Supabase in staging only
