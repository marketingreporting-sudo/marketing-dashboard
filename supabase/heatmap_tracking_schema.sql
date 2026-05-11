create extension if not exists pgcrypto;

create table if not exists public.property_heatmap_sites (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  site_key text not null unique default encode(gen_random_bytes(18), 'hex'),
  name text,
  allowed_domains jsonb not null default '[]'::jsonb,
  tracking_enabled boolean not null default true,
  sampling_rate numeric not null default 0.25 check (sampling_rate >= 0 and sampling_rate <= 1),
  feature_flags jsonb not null default '{"heatmaps": true, "pageSnapshots": true, "screenshots": false}'::jsonb,
  screenshot_capture_frequency text not null default 'manual' check (screenshot_capture_frequency in ('manual', 'daily', 'weekly')),
  consent_mode text not null default 'opt_out' check (consent_mode in ('opt_out', 'required', 'disabled')),
  respect_dnt boolean not null default true,
  screenshot_min_interval_hours integer not null default 24 check (screenshot_min_interval_hours >= 1 and screenshot_min_interval_hours <= 720),
  raw_event_retention_days integer not null default 90 check (raw_event_retention_days >= 1 and raw_event_retention_days <= 365),
  aggregate_retention_days integer not null default 730 check (aggregate_retention_days >= 30 and aggregate_retention_days <= 3650),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.property_heatmap_sites
add column if not exists feature_flags jsonb not null default '{"heatmaps": true, "pageSnapshots": true, "screenshots": false}'::jsonb,
add column if not exists screenshot_capture_frequency text not null default 'manual',
add column if not exists consent_mode text not null default 'opt_out',
add column if not exists respect_dnt boolean not null default true,
add column if not exists screenshot_min_interval_hours integer not null default 24,
add column if not exists raw_event_retention_days integer not null default 90,
add column if not exists aggregate_retention_days integer not null default 730;

alter table public.property_heatmap_sites
drop constraint if exists property_heatmap_sites_screenshot_capture_frequency_check;

alter table public.property_heatmap_sites
add constraint property_heatmap_sites_screenshot_capture_frequency_check
check (screenshot_capture_frequency in ('manual', 'daily', 'weekly'));

alter table public.property_heatmap_sites
drop constraint if exists property_heatmap_sites_consent_mode_check;

alter table public.property_heatmap_sites
add constraint property_heatmap_sites_consent_mode_check
check (consent_mode in ('opt_out', 'required', 'disabled'));

alter table public.property_heatmap_sites
drop constraint if exists property_heatmap_sites_screenshot_min_interval_hours_check;

alter table public.property_heatmap_sites
add constraint property_heatmap_sites_screenshot_min_interval_hours_check
check (screenshot_min_interval_hours >= 1 and screenshot_min_interval_hours <= 720);

alter table public.property_heatmap_sites
drop constraint if exists property_heatmap_sites_raw_event_retention_days_check;

alter table public.property_heatmap_sites
add constraint property_heatmap_sites_raw_event_retention_days_check
check (raw_event_retention_days >= 1 and raw_event_retention_days <= 365);

alter table public.property_heatmap_sites
drop constraint if exists property_heatmap_sites_aggregate_retention_days_check;

alter table public.property_heatmap_sites
add constraint property_heatmap_sites_aggregate_retention_days_check
check (aggregate_retention_days >= 30 and aggregate_retention_days <= 3650);

drop trigger if exists set_property_heatmap_sites_updated_at on public.property_heatmap_sites;
create trigger set_property_heatmap_sites_updated_at
before update on public.property_heatmap_sites
for each row
execute function public.set_updated_at();

create table if not exists public.property_heatmap_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  session_key text not null,
  landing_url text,
  landing_path text,
  referrer text,
  user_agent text,
  device_type text,
  viewport_width integer,
  viewport_height integer,
  screen_width integer,
  screen_height integer,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, session_key)
);

drop trigger if exists set_property_heatmap_sessions_updated_at on public.property_heatmap_sessions;
create trigger set_property_heatmap_sessions_updated_at
before update on public.property_heatmap_sessions
for each row
execute function public.set_updated_at();

create table if not exists public.property_heatmap_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  session_id uuid references public.property_heatmap_sessions(id) on delete set null,
  property_id text not null references public.properties(id) on delete cascade,
  session_key text not null,
  event_type text not null check (event_type in ('click', 'mousemove', 'scroll', 'engagement', 'visibility', 'pageview', 'cta_click', 'page_duration')),
  occurred_at timestamptz not null default now(),
  url text,
  path text,
  viewport_width integer,
  viewport_height integer,
  document_width integer,
  document_height integer,
  x numeric,
  y numeric,
  page_x numeric,
  page_y numeric,
  x_pct numeric,
  y_pct numeric,
  scroll_x numeric,
  scroll_y numeric,
  scroll_depth_pct numeric,
  target_tag text,
  target_id text,
  target_classes text,
  target_role text,
  engagement_ms integer,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.property_heatmap_events
drop constraint if exists property_heatmap_events_event_type_check;

alter table public.property_heatmap_events
add constraint property_heatmap_events_event_type_check
check (event_type in (
  'click',
  'mousemove',
  'pointermove',
  'pointerdown',
  'touchstart',
  'scroll',
  'engagement',
  'visibility',
  'viewport',
  'pageview',
  'first_interaction',
  'tracker_diagnostic',
  'cta_click',
  'page_duration'
));

create table if not exists public.property_site_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  canonical_path text not null,
  canonical_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  latest_title text,
  latest_meta_description text,
  latest_snapshot_id uuid,
  latest_screenshot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, canonical_path)
);

drop trigger if exists set_property_site_pages_updated_at on public.property_site_pages;
create trigger set_property_site_pages_updated_at
before update on public.property_site_pages
for each row
execute function public.set_updated_at();

create table if not exists public.property_site_page_snapshots (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.property_site_pages(id) on delete cascade,
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  captured_at timestamptz not null default now(),
  url text,
  canonical_path text,
  title text,
  meta_description text,
  headings jsonb not null default '[]'::jsonb,
  ctas jsonb not null default '[]'::jsonb,
  internal_links jsonb not null default '[]'::jsonb,
  promo_date_strings jsonb not null default '[]'::jsonb,
  page_structure jsonb not null default '{}'::jsonb,
  screenshot jsonb not null default '{}'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.property_site_screenshots (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.property_site_pages(id) on delete cascade,
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  device_type text not null default 'unknown',
  storage_bucket text,
  storage_path text,
  width integer,
  height integer,
  content_hash text,
  captured_at timestamptz not null default now(),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, device_type)
);

alter table public.property_site_screenshots
add column if not exists raw_data jsonb not null default '{}'::jsonb;

drop trigger if exists set_property_site_screenshots_updated_at on public.property_site_screenshots;
create trigger set_property_site_screenshots_updated_at
before update on public.property_site_screenshots
for each row
execute function public.set_updated_at();

create table if not exists public.property_site_audits (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  site_id uuid references public.property_heatmap_sites(id) on delete set null,
  status text not null default 'ok',
  audited_at timestamptz not null default now(),
  page_count integer not null default 0,
  performance_score numeric,
  urgency_score numeric,
  freshness_score numeric,
  link_score numeric,
  summary text,
  issues jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  broken_links jsonb not null default '[]'::jsonb,
  stale_date_findings jsonb not null default '[]'::jsonb,
  performance_notes jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.property_site_audits
add column if not exists broken_links jsonb not null default '[]'::jsonb,
add column if not exists stale_date_findings jsonb not null default '[]'::jsonb,
add column if not exists performance_notes jsonb not null default '[]'::jsonb;

create table if not exists public.property_heatmap_daily_cells (
  property_id text not null references public.properties(id) on delete cascade,
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  page_id uuid references public.property_site_pages(id) on delete cascade,
  activity_date date not null,
  canonical_path text not null,
  device_type text not null default 'unknown',
  event_type text not null,
  grid_x integer not null,
  grid_y integer not null,
  event_count integer not null default 0,
  session_count integer not null default 0,
  avg_x_pct numeric,
  avg_y_pct numeric,
  max_scroll_depth_pct numeric,
  updated_at timestamptz not null default now(),
  primary key (site_id, activity_date, canonical_path, device_type, event_type, grid_x, grid_y)
);

create table if not exists public.property_site_page_daily_summaries (
  property_id text not null references public.properties(id) on delete cascade,
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  page_id uuid references public.property_site_pages(id) on delete cascade,
  activity_date date not null,
  canonical_path text not null,
  device_type text not null default 'unknown',
  session_count integer not null default 0,
  event_count integer not null default 0,
  click_count integer not null default 0,
  tap_event_count integer not null default 0,
  cta_click_count integer not null default 0,
  cursor_sample_count integer not null default 0,
  scroll_event_count integer not null default 0,
  engagement_event_count integer not null default 0,
  diagnostic_event_count integer not null default 0,
  avg_scroll_depth_pct numeric,
  max_scroll_depth_pct numeric,
  avg_page_duration_ms numeric,
  top_targets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_id, activity_date, canonical_path, device_type)
);

create table if not exists public.property_site_scroll_daily_summaries (
  property_id text not null references public.properties(id) on delete cascade,
  site_id uuid not null references public.property_heatmap_sites(id) on delete cascade,
  page_id uuid references public.property_site_pages(id) on delete cascade,
  activity_date date not null,
  canonical_path text not null,
  device_type text not null default 'unknown',
  session_count integer not null default 0,
  scroll_session_count integer not null default 0,
  scroll_reach jsonb not null default '{}'::jsonb,
  scroll_bands jsonb not null default '[]'::jsonb,
  scroll_band_durations_ms jsonb not null default '{}'::jsonb,
  abandonment_depth_distribution jsonb not null default '[]'::jsonb,
  avg_abandonment_depth_pct numeric,
  first_meaningful_scroll_count integer not null default 0,
  avg_first_meaningful_scroll_ms numeric,
  top_visible_sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (site_id, activity_date, canonical_path, device_type)
);

alter table public.property_site_page_daily_summaries
add column if not exists diagnostic_event_count integer not null default 0;

alter table public.property_site_page_daily_summaries
add column if not exists tap_event_count integer not null default 0;

drop trigger if exists set_property_heatmap_daily_cells_updated_at on public.property_heatmap_daily_cells;
create trigger set_property_heatmap_daily_cells_updated_at
before update on public.property_heatmap_daily_cells
for each row
execute function public.set_updated_at();

drop trigger if exists set_property_site_page_daily_summaries_updated_at on public.property_site_page_daily_summaries;
create trigger set_property_site_page_daily_summaries_updated_at
before update on public.property_site_page_daily_summaries
for each row
execute function public.set_updated_at();

drop trigger if exists set_property_site_scroll_daily_summaries_updated_at on public.property_site_scroll_daily_summaries;
create trigger set_property_site_scroll_daily_summaries_updated_at
before update on public.property_site_scroll_daily_summaries
for each row
execute function public.set_updated_at();

create index if not exists property_heatmap_sites_property_id_idx
on public.property_heatmap_sites(property_id);

create index if not exists property_heatmap_sessions_property_started_idx
on public.property_heatmap_sessions(property_id, started_at desc);

create index if not exists property_heatmap_sessions_site_session_idx
on public.property_heatmap_sessions(site_id, session_key);

create index if not exists property_heatmap_events_property_time_idx
on public.property_heatmap_events(property_id, occurred_at desc);

create index if not exists property_heatmap_events_site_path_type_time_idx
on public.property_heatmap_events(site_id, path, event_type, occurred_at desc);

create index if not exists property_heatmap_events_session_idx
on public.property_heatmap_events(session_id);

create index if not exists property_site_pages_property_path_idx
on public.property_site_pages(property_id, canonical_path);

create index if not exists property_site_page_snapshots_property_captured_idx
on public.property_site_page_snapshots(property_id, captured_at desc);

create index if not exists property_site_page_snapshots_page_captured_idx
on public.property_site_page_snapshots(page_id, captured_at desc);

create index if not exists property_site_screenshots_property_captured_idx
on public.property_site_screenshots(property_id, captured_at desc);

create index if not exists property_site_audits_property_audited_idx
on public.property_site_audits(property_id, audited_at desc);

create index if not exists property_heatmap_daily_cells_property_date_idx
on public.property_heatmap_daily_cells(property_id, activity_date desc);

create index if not exists property_site_page_daily_summaries_property_date_idx
on public.property_site_page_daily_summaries(property_id, activity_date desc);

create index if not exists property_site_scroll_daily_summaries_property_date_idx
on public.property_site_scroll_daily_summaries(property_id, activity_date desc);

alter table public.property_heatmap_sites enable row level security;
alter table public.property_heatmap_sessions enable row level security;
alter table public.property_heatmap_events enable row level security;
alter table public.property_site_pages enable row level security;
alter table public.property_site_page_snapshots enable row level security;
alter table public.property_site_screenshots enable row level security;
alter table public.property_site_audits enable row level security;
alter table public.property_heatmap_daily_cells enable row level security;
alter table public.property_site_page_daily_summaries enable row level security;
alter table public.property_site_scroll_daily_summaries enable row level security;

drop policy if exists "users can read heatmap sites they can access" on public.property_heatmap_sites;
create policy "users can read heatmap sites they can access"
on public.property_heatmap_sites
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can manage heatmap sites for editable websites" on public.property_heatmap_sites;
create policy "users can manage heatmap sites for editable websites"
on public.property_heatmap_sites
for all
to authenticated
using (
  public.user_has_property_permission(property_id, 'website_manager.edit')
  or public.user_has_property_permission(property_id, 'reports.layout.edit')
)
with check (
  public.user_has_property_permission(property_id, 'website_manager.edit')
  or public.user_has_property_permission(property_id, 'reports.layout.edit')
);

drop policy if exists "users can read heatmap sessions they can access" on public.property_heatmap_sessions;
create policy "users can read heatmap sessions they can access"
on public.property_heatmap_sessions
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read heatmap events they can access" on public.property_heatmap_events;
create policy "users can read heatmap events they can access"
on public.property_heatmap_events
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read site pages they can access" on public.property_site_pages;
create policy "users can read site pages they can access"
on public.property_site_pages
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read site page snapshots they can access" on public.property_site_page_snapshots;
create policy "users can read site page snapshots they can access"
on public.property_site_page_snapshots
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read site screenshots they can access" on public.property_site_screenshots;
create policy "users can read site screenshots they can access"
on public.property_site_screenshots
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read site audits they can access" on public.property_site_audits;
create policy "users can read site audits they can access"
on public.property_site_audits
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read heatmap daily cells they can access" on public.property_heatmap_daily_cells;
create policy "users can read heatmap daily cells they can access"
on public.property_heatmap_daily_cells
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read page daily summaries they can access" on public.property_site_page_daily_summaries;
create policy "users can read page daily summaries they can access"
on public.property_site_page_daily_summaries
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read scroll daily summaries they can access" on public.property_site_scroll_daily_summaries;
create policy "users can read scroll daily summaries they can access"
on public.property_site_scroll_daily_summaries
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

create or replace function public.prune_property_site_tracking(
  retain_raw_days integer default 90,
  retain_snapshot_days integer default 30,
  retain_audit_days integer default 365,
  retain_aggregate_days integer default 730
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_events integer := 0;
  deleted_sessions integer := 0;
  deleted_snapshots integer := 0;
  deleted_audits integer := 0;
  deleted_heatmap_aggregates integer := 0;
  deleted_page_aggregates integer := 0;
begin
  delete from public.property_heatmap_events e
  using public.property_heatmap_sites s
  where e.site_id = s.id
    and e.occurred_at < now() - make_interval(days => greatest(coalesce(s.raw_event_retention_days, retain_raw_days), 1));
  get diagnostics deleted_events = row_count;

  delete from public.property_heatmap_events
  where occurred_at < now() - make_interval(days => greatest(retain_raw_days, 1));

  delete from public.property_heatmap_sessions hs
  using public.property_heatmap_sites s
  where hs.site_id = s.id
    and hs.last_seen_at < now() - make_interval(days => greatest(coalesce(s.raw_event_retention_days, retain_raw_days), 1));
  get diagnostics deleted_sessions = row_count;

  delete from public.property_heatmap_sessions
  where last_seen_at < now() - make_interval(days => greatest(retain_raw_days, 1));

  delete from public.property_site_page_snapshots
  where captured_at < now() - make_interval(days => greatest(retain_snapshot_days, 1))
    and id not in (
      select latest_snapshot_id
      from public.property_site_pages
      where latest_snapshot_id is not null
    );
  get diagnostics deleted_snapshots = row_count;

  delete from public.property_site_audits
  where audited_at < now() - make_interval(days => greatest(retain_audit_days, 1));
  get diagnostics deleted_audits = row_count;

  delete from public.property_heatmap_daily_cells c
  using public.property_heatmap_sites s
  where c.site_id = s.id
    and c.activity_date < current_date - greatest(coalesce(s.aggregate_retention_days, retain_aggregate_days), 30);
  get diagnostics deleted_heatmap_aggregates = row_count;

  delete from public.property_heatmap_daily_cells
  where activity_date < current_date - greatest(retain_aggregate_days, 30);

  delete from public.property_site_page_daily_summaries ps
  using public.property_heatmap_sites s
  where ps.site_id = s.id
    and ps.activity_date < current_date - greatest(coalesce(s.aggregate_retention_days, retain_aggregate_days), 30);
  get diagnostics deleted_page_aggregates = row_count;

  delete from public.property_site_page_daily_summaries
  where activity_date < current_date - greatest(retain_aggregate_days, 30);

  delete from public.property_site_scroll_daily_summaries ss
  using public.property_heatmap_sites s
  where ss.site_id = s.id
    and ss.activity_date < current_date - greatest(coalesce(s.aggregate_retention_days, retain_aggregate_days), 30);

  delete from public.property_site_scroll_daily_summaries
  where activity_date < current_date - greatest(retain_aggregate_days, 30);

  return jsonb_build_object(
    'deleted_events', deleted_events,
    'deleted_sessions', deleted_sessions,
    'deleted_snapshots', deleted_snapshots,
    'deleted_audits', deleted_audits,
    'deleted_heatmap_aggregates', deleted_heatmap_aggregates,
    'deleted_page_aggregates', deleted_page_aggregates,
    'retention', jsonb_build_object(
      'raw_days', retain_raw_days,
      'snapshot_days', retain_snapshot_days,
      'audit_days', retain_audit_days,
      'aggregate_days', retain_aggregate_days
    )
  );
end;
$$;

create or replace function public.refresh_property_site_tracking_aggregates(
  start_date date default current_date - 7,
  end_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_cells integer := 0;
  refreshed_pages integer := 0;
  refreshed_scroll integer := 0;
begin
  insert into public.property_heatmap_daily_cells (
    property_id,
    site_id,
    page_id,
    activity_date,
    canonical_path,
    device_type,
    event_type,
    grid_x,
    grid_y,
    event_count,
    session_count,
    avg_x_pct,
    avg_y_pct,
    max_scroll_depth_pct,
    updated_at
  )
  select
    e.property_id,
    e.site_id,
    p.id as page_id,
    e.occurred_at::date as activity_date,
    coalesce(nullif(e.path, ''), '/') as canonical_path,
    coalesce(nullif(e.raw_data->>'deviceType', ''), nullif(e.raw_data->>'device_type', ''), 'unknown') as device_type,
    e.event_type,
    case
      when e.event_type = 'scroll' then 0
      else least(23, greatest(0, floor(coalesce(e.x_pct, 0) * 24)::integer))
    end as grid_x,
    case
      when e.event_type = 'scroll' then least(23, greatest(0, floor(coalesce(e.scroll_depth_pct, 0) * 24)::integer))
      else least(23, greatest(0, floor(coalesce(e.y_pct, 0) * 24)::integer))
    end as grid_y,
    count(*)::integer as event_count,
    count(distinct e.session_key)::integer as session_count,
    avg(e.x_pct) as avg_x_pct,
    avg(e.y_pct) as avg_y_pct,
    max(e.scroll_depth_pct) as max_scroll_depth_pct,
    now() as updated_at
  from public.property_heatmap_events e
  left join public.property_site_pages p
    on p.site_id = e.site_id
   and p.canonical_path = coalesce(nullif(e.path, ''), '/')
  where e.occurred_at::date between start_date and end_date
  group by
    e.property_id,
    e.site_id,
    p.id,
    e.occurred_at::date,
    coalesce(nullif(e.path, ''), '/'),
    coalesce(nullif(e.raw_data->>'deviceType', ''), nullif(e.raw_data->>'device_type', ''), 'unknown'),
    e.event_type,
    case
      when e.event_type = 'scroll' then 0
      else least(23, greatest(0, floor(coalesce(e.x_pct, 0) * 24)::integer))
    end,
    case
      when e.event_type = 'scroll' then least(23, greatest(0, floor(coalesce(e.scroll_depth_pct, 0) * 24)::integer))
      else least(23, greatest(0, floor(coalesce(e.y_pct, 0) * 24)::integer))
    end
  on conflict (site_id, activity_date, canonical_path, device_type, event_type, grid_x, grid_y)
  do update set
    property_id = excluded.property_id,
    page_id = excluded.page_id,
    event_count = excluded.event_count,
    session_count = excluded.session_count,
    avg_x_pct = excluded.avg_x_pct,
    avg_y_pct = excluded.avg_y_pct,
    max_scroll_depth_pct = excluded.max_scroll_depth_pct,
    updated_at = now();
  get diagnostics refreshed_cells = row_count;

  insert into public.property_site_page_daily_summaries (
    property_id,
    site_id,
    page_id,
    activity_date,
    canonical_path,
    device_type,
    session_count,
    event_count,
    click_count,
    tap_event_count,
    cta_click_count,
    cursor_sample_count,
    scroll_event_count,
    engagement_event_count,
    diagnostic_event_count,
    avg_scroll_depth_pct,
    max_scroll_depth_pct,
    avg_page_duration_ms,
    top_targets,
    updated_at
  )
  select
    grouped.property_id,
    grouped.site_id,
    grouped.page_id,
    grouped.activity_date,
    grouped.canonical_path,
    grouped.device_type,
    grouped.session_count,
    grouped.event_count,
    grouped.click_count,
    grouped.tap_event_count,
    grouped.cta_click_count,
    grouped.cursor_sample_count,
    grouped.scroll_event_count,
    grouped.engagement_event_count,
    grouped.diagnostic_event_count,
    grouped.avg_scroll_depth_pct,
    grouped.max_scroll_depth_pct,
    grouped.avg_page_duration_ms,
    coalesce(targets.top_targets, '[]'::jsonb) as top_targets,
    now() as updated_at
  from (
    select
      e.property_id,
      e.site_id,
      p.id as page_id,
      e.occurred_at::date as activity_date,
      coalesce(nullif(e.path, ''), '/') as canonical_path,
      coalesce(nullif(e.raw_data->>'deviceType', ''), nullif(e.raw_data->>'device_type', ''), 'unknown') as device_type,
      count(distinct e.session_key)::integer as session_count,
      count(*)::integer as event_count,
      count(*) filter (where e.event_type in ('click', 'pointerdown', 'touchstart'))::integer as click_count,
      count(*) filter (where e.event_type in ('pointerdown', 'touchstart'))::integer as tap_event_count,
      count(*) filter (where e.event_type = 'cta_click')::integer as cta_click_count,
      count(*) filter (where e.event_type in ('mousemove', 'pointermove'))::integer as cursor_sample_count,
      count(*) filter (where e.event_type = 'scroll')::integer as scroll_event_count,
      count(*) filter (where e.event_type in ('engagement', 'first_interaction', 'page_duration'))::integer as engagement_event_count,
      count(*) filter (where e.event_type = 'tracker_diagnostic')::integer as diagnostic_event_count,
      avg(e.scroll_depth_pct) filter (where e.scroll_depth_pct is not null) as avg_scroll_depth_pct,
      max(e.scroll_depth_pct) as max_scroll_depth_pct,
      avg(e.engagement_ms) filter (where e.event_type = 'page_duration') as avg_page_duration_ms
    from public.property_heatmap_events e
    left join public.property_site_pages p
      on p.site_id = e.site_id
     and p.canonical_path = coalesce(nullif(e.path, ''), '/')
    where e.occurred_at::date between start_date and end_date
    group by
      e.property_id,
      e.site_id,
      p.id,
      e.occurred_at::date,
      coalesce(nullif(e.path, ''), '/'),
      coalesce(nullif(e.raw_data->>'deviceType', ''), nullif(e.raw_data->>'device_type', ''), 'unknown')
  ) grouped
  left join lateral (
    select jsonb_agg(jsonb_build_object('label', target_label, 'count', target_count) order by target_count desc) as top_targets
    from (
      select
        coalesce(nullif(e.raw_data->>'targetLabel', ''), nullif(e.raw_data->>'targetTrackId', ''), nullif(e.raw_data->>'targetSelector', ''), nullif(e.raw_data->>'target_label', ''), e.target_tag, 'unknown') as target_label,
        count(*)::integer as target_count
      from public.property_heatmap_events e
      where e.site_id = grouped.site_id
        and e.occurred_at::date = grouped.activity_date
        and coalesce(nullif(e.path, ''), '/') = grouped.canonical_path
        and coalesce(nullif(e.raw_data->>'deviceType', ''), nullif(e.raw_data->>'device_type', ''), 'unknown') = grouped.device_type
        and e.event_type in ('click', 'cta_click', 'pointerdown', 'touchstart')
      group by coalesce(nullif(e.raw_data->>'targetLabel', ''), nullif(e.raw_data->>'targetTrackId', ''), nullif(e.raw_data->>'targetSelector', ''), nullif(e.raw_data->>'target_label', ''), e.target_tag, 'unknown')
      order by target_count desc
      limit 10
    ) ranked_targets
  ) targets on true
  on conflict (site_id, activity_date, canonical_path, device_type)
  do update set
    property_id = excluded.property_id,
    page_id = excluded.page_id,
    session_count = excluded.session_count,
    event_count = excluded.event_count,
    click_count = excluded.click_count,
    tap_event_count = excluded.tap_event_count,
    cta_click_count = excluded.cta_click_count,
    cursor_sample_count = excluded.cursor_sample_count,
    scroll_event_count = excluded.scroll_event_count,
    engagement_event_count = excluded.engagement_event_count,
    diagnostic_event_count = excluded.diagnostic_event_count,
    avg_scroll_depth_pct = excluded.avg_scroll_depth_pct,
    max_scroll_depth_pct = excluded.max_scroll_depth_pct,
    avg_page_duration_ms = excluded.avg_page_duration_ms,
    top_targets = excluded.top_targets,
    updated_at = now();
  get diagnostics refreshed_pages = row_count;

  insert into public.property_site_scroll_daily_summaries (
    property_id,
    site_id,
    page_id,
    activity_date,
    canonical_path,
    device_type,
    session_count,
    scroll_session_count,
    scroll_reach,
    scroll_bands,
    scroll_band_durations_ms,
    abandonment_depth_distribution,
    avg_abandonment_depth_pct,
    first_meaningful_scroll_count,
    avg_first_meaningful_scroll_ms,
    top_visible_sections,
    updated_at
  )
  with base as (
    select
      e.property_id,
      e.site_id,
      p.id as page_id,
      e.occurred_at::date as activity_date,
      coalesce(nullif(e.path, ''), '/') as canonical_path,
      coalesce(nullif(e.raw_data->>'deviceType', ''), nullif(e.raw_data->>'device_type', ''), 'unknown') as device_type,
      e.session_key,
      e.event_type,
      e.scroll_depth_pct,
      e.raw_data
    from public.property_heatmap_events e
    left join public.property_site_pages p
      on p.site_id = e.site_id
     and p.canonical_path = coalesce(nullif(e.path, ''), '/')
    where e.occurred_at::date between start_date and end_date
  ),
  grouped as (
    select
      property_id,
      site_id,
      page_id,
      activity_date,
      canonical_path,
      device_type,
      count(distinct session_key)::integer as session_count,
      count(distinct session_key) filter (where scroll_depth_pct is not null)::integer as scroll_session_count
    from base
    group by property_id, site_id, page_id, activity_date, canonical_path, device_type
  ),
  session_depths as (
    select
      property_id,
      site_id,
      page_id,
      activity_date,
      canonical_path,
      device_type,
      session_key,
      max(greatest(
        coalesce(scroll_depth_pct, 0),
        coalesce(nullif(raw_data->>'abandonmentDepthPct', '')::numeric, 0)
      )) as max_scroll_depth_pct,
      max(coalesce(
        nullif(raw_data->>'abandonmentDepthPct', '')::numeric,
        scroll_depth_pct,
        0
      )) as abandonment_depth_pct,
      min(nullif(raw_data->>'firstMeaningfulScrollMs', '')::numeric)
        filter (where raw_data->>'firstMeaningfulScroll' = 'true') as first_meaningful_scroll_ms
    from base
    group by property_id, site_id, page_id, activity_date, canonical_path, device_type, session_key
  ),
  reach as (
    select
      g.property_id,
      g.site_id,
      g.activity_date,
      g.canonical_path,
      g.device_type,
      jsonb_object_agg(
        (threshold * 10)::text,
        jsonb_build_object(
          'thresholdPct', threshold * 10,
          'sessions', coalesce(reached.sessions_reached, 0),
          'percent', case when g.session_count > 0 then coalesce(reached.sessions_reached, 0)::numeric / g.session_count else 0 end
        )
        order by threshold
      ) as scroll_reach,
      jsonb_agg(
        jsonb_build_object(
          'startPct', (threshold - 1) * 10,
          'endPct', threshold * 10,
          'sessionsReached', coalesce(reached.sessions_reached, 0),
          'percentReached', case when g.session_count > 0 then coalesce(reached.sessions_reached, 0)::numeric / g.session_count else 0 end
        )
        order by threshold
      ) as scroll_bands
    from grouped g
    cross join generate_series(1, 10) as threshold
    left join lateral (
      select count(*)::integer as sessions_reached
      from session_depths sd
      where sd.site_id = g.site_id
        and sd.activity_date = g.activity_date
        and sd.canonical_path = g.canonical_path
        and sd.device_type = g.device_type
        and sd.max_scroll_depth_pct >= threshold::numeric / 10.0
    ) reached on true
    group by g.property_id, g.site_id, g.activity_date, g.canonical_path, g.device_type, g.session_count
  ),
  band_duration_totals as (
    select
      property_id,
      site_id,
      activity_date,
      canonical_path,
      device_type,
      jsonb_object_agg(band_key, duration_ms order by band_key) as scroll_band_durations_ms
    from (
      select
        property_id,
        site_id,
        activity_date,
        canonical_path,
        device_type,
        band_key,
        sum(max_duration_ms)::bigint as duration_ms
      from (
        select
          b.property_id,
          b.site_id,
          b.activity_date,
          b.canonical_path,
          b.device_type,
          b.session_key,
          band.key as band_key,
          max(nullif(band.value, '')::numeric)::bigint as max_duration_ms
        from base b
        cross join lateral jsonb_each_text(
          case
            when jsonb_typeof(b.raw_data->'scrollBandDurations') = 'object' then b.raw_data->'scrollBandDurations'
            else '{}'::jsonb
          end
        ) band
        where b.raw_data->>'finalScrollEvent' = 'true'
        group by b.property_id, b.site_id, b.activity_date, b.canonical_path, b.device_type, b.session_key, band.key
      ) per_session_band
      group by property_id, site_id, activity_date, canonical_path, device_type, band_key
    ) band_totals
    group by property_id, site_id, activity_date, canonical_path, device_type
  ),
  abandonment as (
    select
      g.property_id,
      g.site_id,
      g.activity_date,
      g.canonical_path,
      g.device_type,
      coalesce(avg_depth.avg_abandonment_depth_pct, 0) as avg_abandonment_depth_pct,
      jsonb_agg(
        jsonb_build_object(
          'startPct', band_start * 10,
          'endPct', (band_start + 1) * 10,
          'sessions', coalesce(band_counts.sessions_in_band, 0),
          'percent', case when g.session_count > 0 then coalesce(band_counts.sessions_in_band, 0)::numeric / g.session_count else 0 end
        )
        order by band_start
      ) as abandonment_depth_distribution
    from grouped g
    cross join generate_series(0, 9) as band_start
    left join lateral (
      select avg(coalesce(sd.abandonment_depth_pct, sd.max_scroll_depth_pct, 0)) as avg_abandonment_depth_pct
      from session_depths sd
      where sd.site_id = g.site_id
        and sd.activity_date = g.activity_date
        and sd.canonical_path = g.canonical_path
        and sd.device_type = g.device_type
    ) avg_depth on true
    left join lateral (
      select count(*)::integer as sessions_in_band
      from session_depths sd
      where sd.site_id = g.site_id
        and sd.activity_date = g.activity_date
        and sd.canonical_path = g.canonical_path
        and sd.device_type = g.device_type
        and coalesce(sd.abandonment_depth_pct, sd.max_scroll_depth_pct, 0) >= band_start::numeric / 10.0
        and (
          band_start = 9
          or coalesce(sd.abandonment_depth_pct, sd.max_scroll_depth_pct, 0) < (band_start + 1)::numeric / 10.0
        )
    ) band_counts on true
    group by g.property_id, g.site_id, g.activity_date, g.canonical_path, g.device_type, g.session_count, avg_depth.avg_abandonment_depth_pct
  ),
  first_scroll as (
    select
      property_id,
      site_id,
      activity_date,
      canonical_path,
      device_type,
      count(*) filter (where first_meaningful_scroll_ms is not null)::integer as first_meaningful_scroll_count,
      avg(first_meaningful_scroll_ms) filter (where first_meaningful_scroll_ms is not null) as avg_first_meaningful_scroll_ms
    from session_depths
    group by property_id, site_id, activity_date, canonical_path, device_type
  ),
  section_session as (
    select
      b.property_id,
      b.site_id,
      b.activity_date,
      b.canonical_path,
      b.device_type,
      b.session_key,
      nullif(section_item->>'label', '') as label,
      max(coalesce(nullif(section_item->>'visibleMs', '')::numeric, 0)) as visible_ms,
      max(coalesce(nullif(section_item->>'maxVisiblePct', '')::numeric, 0)) as max_visible_pct,
      min(nullif(section_item->>'topPct', '')::numeric) as top_pct
    from base b
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(b.raw_data->'sectionExposure') = 'array' then b.raw_data->'sectionExposure'
        else '[]'::jsonb
      end
    ) section_item
    where b.raw_data->>'finalScrollEvent' = 'true'
      and nullif(section_item->>'label', '') is not null
    group by b.property_id, b.site_id, b.activity_date, b.canonical_path, b.device_type, b.session_key, nullif(section_item->>'label', '')
  ),
  section_totals as (
    select
      property_id,
      site_id,
      activity_date,
      canonical_path,
      device_type,
      label,
      sum(visible_ms)::bigint as visible_ms,
      max(max_visible_pct) as max_visible_pct,
      min(top_pct) as top_pct
    from section_session
    group by property_id, site_id, activity_date, canonical_path, device_type, label
  ),
  section_ranked as (
    select
      *,
      row_number() over (
        partition by property_id, site_id, activity_date, canonical_path, device_type
        order by visible_ms desc
      ) as section_rank
    from section_totals
  ),
  sections as (
    select
      property_id,
      site_id,
      activity_date,
      canonical_path,
      device_type,
      jsonb_agg(
        jsonb_build_object(
          'label', label,
          'visibleMs', visible_ms,
          'maxVisiblePct', max_visible_pct,
          'topPct', top_pct
        )
        order by visible_ms desc
      ) as top_visible_sections
    from section_ranked
    where section_rank <= 12
    group by property_id, site_id, activity_date, canonical_path, device_type
  )
  select
    g.property_id,
    g.site_id,
    g.page_id,
    g.activity_date,
    g.canonical_path,
    g.device_type,
    g.session_count,
    g.scroll_session_count,
    coalesce(r.scroll_reach, '{}'::jsonb) as scroll_reach,
    coalesce(r.scroll_bands, '[]'::jsonb) as scroll_bands,
    coalesce(bd.scroll_band_durations_ms, '{}'::jsonb) as scroll_band_durations_ms,
    coalesce(a.abandonment_depth_distribution, '[]'::jsonb) as abandonment_depth_distribution,
    a.avg_abandonment_depth_pct,
    coalesce(fs.first_meaningful_scroll_count, 0) as first_meaningful_scroll_count,
    fs.avg_first_meaningful_scroll_ms,
    coalesce(s.top_visible_sections, '[]'::jsonb) as top_visible_sections,
    now() as updated_at
  from grouped g
  left join reach r
    on r.site_id = g.site_id
   and r.activity_date = g.activity_date
   and r.canonical_path = g.canonical_path
   and r.device_type = g.device_type
  left join band_duration_totals bd
    on bd.site_id = g.site_id
   and bd.activity_date = g.activity_date
   and bd.canonical_path = g.canonical_path
   and bd.device_type = g.device_type
  left join abandonment a
    on a.site_id = g.site_id
   and a.activity_date = g.activity_date
   and a.canonical_path = g.canonical_path
   and a.device_type = g.device_type
  left join first_scroll fs
    on fs.site_id = g.site_id
   and fs.activity_date = g.activity_date
   and fs.canonical_path = g.canonical_path
   and fs.device_type = g.device_type
  left join sections s
    on s.site_id = g.site_id
   and s.activity_date = g.activity_date
   and s.canonical_path = g.canonical_path
   and s.device_type = g.device_type
  on conflict (site_id, activity_date, canonical_path, device_type)
  do update set
    property_id = excluded.property_id,
    page_id = excluded.page_id,
    session_count = excluded.session_count,
    scroll_session_count = excluded.scroll_session_count,
    scroll_reach = excluded.scroll_reach,
    scroll_bands = excluded.scroll_bands,
    scroll_band_durations_ms = excluded.scroll_band_durations_ms,
    abandonment_depth_distribution = excluded.abandonment_depth_distribution,
    avg_abandonment_depth_pct = excluded.avg_abandonment_depth_pct,
    first_meaningful_scroll_count = excluded.first_meaningful_scroll_count,
    avg_first_meaningful_scroll_ms = excluded.avg_first_meaningful_scroll_ms,
    top_visible_sections = excluded.top_visible_sections,
    updated_at = now();
  get diagnostics refreshed_scroll = row_count;

  return jsonb_build_object(
    'refreshed_cells', refreshed_cells,
    'refreshed_pages', refreshed_pages,
    'refreshed_scroll', refreshed_scroll,
    'start_date', start_date,
    'end_date', end_date
  );
end;
$$;
