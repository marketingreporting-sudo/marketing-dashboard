# Redstone Dashboard

This frontend is a Vite/React dashboard for live leasing and marketing analytics stored in Firestore.

## What It Shows

- Leads, tours, applications, leases, and invoice-derived marketing cost
- Date-range filtering over Firestore `property_data`
- Daily trend charts and live source/status breakdowns

## Data Source

The app reads Firestore documents created by the Python Firebase Functions in the sibling `functions/` directory. Those functions ingest data from Entrata and write daily records into:

- `property_data/{propertyId_date}`
- `property_data/{propertyId_date}/leads`
- `property_data/{propertyId_date}/events`
- `property_data/{propertyId_date}/leases`
- `property_data/{propertyId_date}/invoices`

Normalized lease attribution records are also written for ROI reporting into:

- `properties/{propertyId}/leases/{leaseId}`
- `properties/{propertyId}/roi_daily/{yyyy-mm-dd}`

Those normalized lease docs include lease financials, reporting-window metadata, and matched lead attribution fields when a lead/application correlation is found.
The daily ROI docs include attributed lease counts, gross/net revenue, concessions, allocated marketing spend, ROI, and source-level breakdowns for live dashboard reads.

Operationally:

- `start_ytd_roi_backfill` starts a year-to-date raw sync + attribution + ROI backfill job.
- `start_daily_roi_pipeline_scheduled` starts the daily refresh at 2:00 AM America/Denver.
- `run_roi_pipeline_jobs_scheduled` advances active ROI pipeline jobs every 5 minutes until they complete.
- `get_roi_pipeline_status` exposes the current ROI pipeline state for the YTD backfill and daily refresh jobs.

## Local Development

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```
