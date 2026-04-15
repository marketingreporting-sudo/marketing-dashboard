-- Second-pass lease schema for snapshot-scoped Firestore lease documents.
-- Source path:
--   property_data/{propertySnapshotId}/leases/{leaseId}

create table if not exists public.property_snapshot_leases (
  id text primary key,
  property_snapshot_id text not null references public.property_daily_snapshots(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  lease_id text,
  reporting_window_start date,
  reporting_window_end date,
  attribution_status text,
  attribution_event_date date,
  lease_term_months integer,
  lease_start_date date,
  lease_end_date date,
  move_in_date date,
  move_out_date date,
  gross_lease_value numeric(14,2),
  net_effective_rent numeric(14,2),
  net_effective_revenue numeric(14,2),
  concession_total numeric(14,2),
  lead_attribution jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_snapshot_leases_snapshot
  on public.property_snapshot_leases (property_snapshot_id);

create index if not exists idx_property_snapshot_leases_property_date
  on public.property_snapshot_leases (property_id, activity_date desc);

create index if not exists idx_property_snapshot_leases_attribution_status
  on public.property_snapshot_leases (attribution_status);

create trigger set_property_snapshot_leases_updated_at
before update on public.property_snapshot_leases
for each row
execute function public.set_updated_at();
