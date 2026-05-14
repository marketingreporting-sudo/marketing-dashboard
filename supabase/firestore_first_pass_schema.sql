-- First-pass Supabase schema for migrating this project off Firestore/Firebase.
-- Strategy:
-- 1. Keep source payloads in jsonb so the Firestore export can land quickly.
-- 2. Pull out the fields the current dashboard and backend already query.
-- 3. Model Firestore subcollections as normal relational tables keyed by property_id/date/document_id.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.properties (
  id text primary key,
  name text,
  city text,
  state text,
  portfolio text,
  org_slug text,
  google_ads_id text,
  google_analytics_id text,
  meta_ads_account_id text,
  meta_ads_match_terms jsonb not null default '[]'::jsonb,
  opiniion_location_id text,
  opiniion_location_name text,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_properties_updated_at on public.properties;
create trigger set_properties_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

create table if not exists public.property_daily_snapshots (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  activity_at timestamptz,
  source_date_id text not null,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, activity_date)
);

create index if not exists idx_property_daily_snapshots_property_date
  on public.property_daily_snapshots (property_id, activity_date desc);

drop trigger if exists set_property_daily_snapshots_updated_at on public.property_daily_snapshots;
create trigger set_property_daily_snapshots_updated_at
before update on public.property_daily_snapshots
for each row
execute function public.set_updated_at();

create table if not exists public.property_leads (
  id text primary key,
  property_snapshot_id text not null references public.property_daily_snapshots(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  lead_id text,
  application_id text,
  customer_id text,
  prospect_id text,
  status text,
  lead_source text,
  internet_listing_service text,
  attribution jsonb not null default '{}'::jsonb,
  lease_ids jsonb not null default '[]'::jsonb,
  lease_paths jsonb not null default '[]'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_leads_property_date
  on public.property_leads (property_id, activity_date desc);

create index if not exists idx_property_leads_application_id
  on public.property_leads (application_id);

create index if not exists idx_property_leads_lead_id
  on public.property_leads (lead_id);

drop trigger if exists set_property_leads_updated_at on public.property_leads;
create trigger set_property_leads_updated_at
before update on public.property_leads
for each row
execute function public.set_updated_at();

create table if not exists public.property_events (
  id text primary key,
  property_snapshot_id text not null references public.property_daily_snapshots(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  event_id text,
  type_id integer,
  event_type text,
  event_reason text,
  application_id text,
  lease_id text,
  lease_interval_id text,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_events_property_date
  on public.property_events (property_id, activity_date desc);

create index if not exists idx_property_events_type_id
  on public.property_events (type_id);

drop trigger if exists set_property_events_updated_at on public.property_events;
create trigger set_property_events_updated_at
before update on public.property_events
for each row
execute function public.set_updated_at();

create table if not exists public.property_invoices (
  id text primary key,
  property_snapshot_id text not null references public.property_daily_snapshots(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  invoice_id text,
  reference_number text,
  vendor_name text,
  contract text,
  post_date date,
  invoice_date date,
  transaction_date date,
  post_month text,
  amount numeric(14,2),
  gl_account_number text,
  gl_account_name text,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_invoices_property_date
  on public.property_invoices (property_id, activity_date desc);

create index if not exists idx_property_invoices_gl_account_number
  on public.property_invoices (gl_account_number);

drop trigger if exists set_property_invoices_updated_at on public.property_invoices;
create trigger set_property_invoices_updated_at
before update on public.property_invoices
for each row
execute function public.set_updated_at();

create table if not exists public.property_availability (
  id text primary key,
  property_snapshot_id text not null references public.property_daily_snapshots(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  unit_id text,
  unit_number text,
  floorplan_name text,
  availability_status text,
  available_on date,
  price numeric(12,2),
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_availability_property_date
  on public.property_availability (property_id, activity_date desc);

drop trigger if exists set_property_availability_updated_at on public.property_availability;
create trigger set_property_availability_updated_at
before update on public.property_availability
for each row
execute function public.set_updated_at();

create table if not exists public.property_specials_current (
  property_id text primary key references public.properties(id) on delete cascade,
  special_count integer not null default 0,
  specials_hash text,
  specials jsonb not null default '[]'::jsonb,
  raw_result jsonb not null default '{}'::jsonb,
  portfolio text,
  org_slug text,
  last_changed_at timestamptz,
  last_synced_at timestamptz,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_property_specials_current_updated_at on public.property_specials_current;
create trigger set_property_specials_current_updated_at
before update on public.property_specials_current
for each row
execute function public.set_updated_at();

create table if not exists public.property_availability_snapshots (
  property_id text primary key references public.properties(id) on delete cascade,
  floorplan_count integer not null default 0,
  unit_count integer not null default 0,
  availability_url text,
  snapshot_hash text,
  property_payload jsonb not null default '{}'::jsonb,
  floorplans jsonb not null default '[]'::jsonb,
  units jsonb not null default '[]'::jsonb,
  raw_result jsonb not null default '{}'::jsonb,
  portfolio text,
  org_slug text,
  last_changed_at timestamptz,
  last_synced_at timestamptz,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_property_availability_snapshots_updated_at on public.property_availability_snapshots;
create trigger set_property_availability_snapshots_updated_at
before update on public.property_availability_snapshots
for each row
execute function public.set_updated_at();

create table if not exists public.property_leases (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
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

create index if not exists idx_property_leases_property_event_date
  on public.property_leases (property_id, attribution_event_date desc);

create index if not exists idx_property_leases_property_reporting_window
  on public.property_leases (property_id, reporting_window_end, reporting_window_start);

create index if not exists idx_property_leases_attribution_status
  on public.property_leases (attribution_status);

drop trigger if exists set_property_leases_updated_at on public.property_leases;
create trigger set_property_leases_updated_at
before update on public.property_leases
for each row
execute function public.set_updated_at();

create table if not exists public.property_roi_daily (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  activity_date date not null,
  attributed_leases integer not null default 0,
  unattributed_leases integer not null default 0,
  gross_lease_value numeric(14,2) not null default 0,
  net_effective_revenue numeric(14,2) not null default 0,
  concession_total numeric(14,2) not null default 0,
  marketing_spend numeric(14,2) not null default 0,
  performance_marketing_spend numeric(14,2) not null default 0,
  roi numeric(14,4),
  source_metrics jsonb not null default '[]'::jsonb,
  invoice_channels jsonb not null default '[]'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  last_aggregated_at timestamptz,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, activity_date)
);

create index if not exists idx_property_roi_daily_property_date
  on public.property_roi_daily (property_id, activity_date desc);

drop trigger if exists set_property_roi_daily_updated_at on public.property_roi_daily;
create trigger set_property_roi_daily_updated_at
before update on public.property_roi_daily
for each row
execute function public.set_updated_at();

create table if not exists public.property_analytics_snapshots (
  property_id text not null references public.properties(id) on delete cascade,
  snapshot_type text not null,
  fetched_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, snapshot_type)
);

drop trigger if exists set_property_analytics_snapshots_updated_at on public.property_analytics_snapshots;
create trigger set_property_analytics_snapshots_updated_at
before update on public.property_analytics_snapshots
for each row
execute function public.set_updated_at();

create table if not exists public.property_website_manager_current (
  property_id text primary key references public.properties(id) on delete cascade,
  property_name text,
  platform text not null default 'unknown',
  website_url text,
  wordpress_site_key text,
  notes text,
  editable boolean not null default false,
  content jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_property_website_manager_current_updated_at on public.property_website_manager_current;
create trigger set_property_website_manager_current_updated_at
before update on public.property_website_manager_current
for each row
execute function public.set_updated_at();

create table if not exists public.property_reporting_layout_current (
  property_id text primary key references public.properties(id) on delete cascade,
  property_name text,
  panel_order jsonb not null default '[]'::jsonb,
  hidden_panel_ids jsonb not null default '[]'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_property_reporting_layout_current_updated_at on public.property_reporting_layout_current;
create trigger set_property_reporting_layout_current_updated_at
before update on public.property_reporting_layout_current
for each row
execute function public.set_updated_at();

create table if not exists public.sync_state (
  id text primary key,
  active boolean not null default true,
  completed boolean not null default false,
  run_date date,
  phase text,
  initiated_by text,
  target_offsets jsonb not null default '[]'::jsonb,
  property_ids jsonb not null default '[]'::jsonb,
  raw_start_date date,
  raw_end_date date,
  report_start_date date,
  report_end_date date,
  raw_day_index integer,
  raw_property_index integer,
  attribution_property_index integer,
  aggregate_property_index integer,
  batch_size integer,
  raw_batch_size integer,
  property_batch_size integer,
  total_days integer,
  next_day_offset integer,
  next_property_index integer,
  last_summary text,
  last_attribution_results jsonb not null default '[]'::jsonb,
  last_aggregate_results jsonb not null default '[]'::jsonb,
  last_processed_count integer,
  last_skipped_count integer,
  last_error_count integer,
  started_at timestamptz,
  completed_at timestamptz,
  last_processed_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_sync_state_updated_at on public.sync_state;
create trigger set_sync_state_updated_at
before update on public.sync_state
for each row
execute function public.set_updated_at();

create table if not exists public.sync_retries (
  id text primary key,
  job_type text not null,
  property_id text references public.properties(id) on delete set null,
  date_id date,
  date_str text,
  attempts integer not null default 0,
  last_error text,
  abandoned boolean not null default false,
  abandon_reason text,
  abandoned_at timestamptz,
  last_queued_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sync_retries_active_queue
  on public.sync_retries (abandoned, attempts, last_queued_at desc);

drop trigger if exists set_sync_retries_updated_at on public.sync_retries;
create trigger set_sync_retries_updated_at
before update on public.sync_retries
for each row
execute function public.set_updated_at();

create table if not exists public.lease_details (
  id text primary key,
  property_id text references public.properties(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  fetched_at timestamptz,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_lease_details_updated_at on public.lease_details;
create trigger set_lease_details_updated_at
before update on public.lease_details
for each row
execute function public.set_updated_at();

create table if not exists public.site_audits (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  audited_at timestamptz,
  pages_audited jsonb not null default '[]'::jsonb,
  broken_links jsonb not null default '[]'::jsonb,
  missing_meta jsonb not null default '[]'::jsonb,
  headline_optimizations jsonb not null default '[]'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_site_audits_updated_at on public.site_audits;
create trigger set_site_audits_updated_at
before update on public.site_audits
for each row
execute function public.set_updated_at();

create table if not exists public.marketing_opportunities (
  id uuid primary key default gen_random_uuid(),
  source text,
  query text,
  title text,
  url text,
  event_timestamp timestamptz,
  scraped_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  firestore_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketing_opportunities_source
  on public.marketing_opportunities (source, scraped_at desc);

drop trigger if exists set_marketing_opportunities_updated_at on public.marketing_opportunities;
create trigger set_marketing_opportunities_updated_at
before update on public.marketing_opportunities
for each row
execute function public.set_updated_at();

-- Optional compatibility views if you want to keep the frontend migration simple.
create or replace view public.property_daily_metrics as
select
  snapshot.property_id,
  snapshot.activity_date,
  count(distinct lead.id) as lead_count,
  count(distinct event.id) filter (
    where event.type_id = 12
      and lower(coalesce(event.event_reason, event.event_type, '')) like '%application%completed%'
  ) as application_count,
  count(distinct event.id) filter (
    where event.type_id = 13
      and lower(coalesce(event.event_reason, event.event_type, '')) like '%lease status%approved%'
      and lower(coalesce(event.event_reason, event.event_type, '')) not like '%renewal lease%'
  ) as lease_event_count,
  coalesce(sum(invoice.amount), 0) as invoice_amount
from public.property_daily_snapshots snapshot
left join public.property_leads lead on lead.property_snapshot_id = snapshot.id
left join public.property_events event on event.property_snapshot_id = snapshot.id
left join public.property_invoices invoice on invoice.property_snapshot_id = snapshot.id
group by snapshot.property_id, snapshot.activity_date;
