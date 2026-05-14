-- Auth + authorization model for property-scoped dashboard access.
-- Apply after the base relational schema so the referenced tables already exist.

create extension if not exists pgcrypto;

create table if not exists public.app_roles (
  name text primary key,
  scope text not null check (scope in ('global', 'property')),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role text not null references public.app_roles(name) on delete cascade,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role, permission)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_path text,
  avatar_url text,
  global_role text references public.app_roles(name) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_url text;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.property_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  role text not null references public.app_roles(name) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, property_id)
);

create index if not exists idx_property_memberships_user_active
  on public.property_memberships (user_id, is_active);

create index if not exists idx_property_memberships_property_active
  on public.property_memberships (property_id, is_active);

drop trigger if exists set_property_memberships_updated_at on public.property_memberships;
create trigger set_property_memberships_updated_at
before update on public.property_memberships
for each row
execute function public.set_updated_at();

create table if not exists public.user_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  property_id text not null references public.properties(id) on delete restrict,
  title text not null,
  description text not null default '',
  notes text not null default '',
  due_date date,
  status text not null default 'new' check (status in (
    'new',
    'in_progress',
    'on_hold',
    'awaiting_approval',
    'approved',
    'complete'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_tasks_owner_status
  on public.user_tasks (owner_user_id, status, updated_at desc);

create index if not exists idx_user_tasks_property
  on public.user_tasks (property_id);

create index if not exists idx_user_tasks_property_updated
  on public.user_tasks (property_id, updated_at desc);

drop trigger if exists set_user_tasks_updated_at on public.user_tasks;
create trigger set_user_tasks_updated_at
before update on public.user_tasks
for each row
execute function public.set_updated_at();

create table if not exists public.access_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null check (action in ('invite_user', 'update_user_access')),
  target_user_id uuid references auth.users(id) on delete set null,
  target_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_access_audit_logs_created_at
  on public.access_audit_logs (created_at desc);

create index if not exists idx_access_audit_logs_target_user
  on public.access_audit_logs (target_user_id, created_at desc);

insert into public.app_roles (name, scope, description)
values
  ('admin', 'global', 'Full platform access across all properties and admin workflows.'),
  ('regional_manager', 'property', 'Access to analytics, reporting, website manager, reputation, and property info for assigned properties.'),
  ('community_manager', 'property', 'Access to analytics and website manager for assigned properties.'),
  ('client', 'property', 'Read-only client access to reporting for assigned properties.')
on conflict (name) do update
set scope = excluded.scope,
    description = excluded.description;

insert into public.role_permissions (role, permission)
values
  ('admin', 'properties.view_all'),
  ('admin', 'dashboard.view'),
  ('admin', 'reports.view'),
  ('admin', 'analytics.view'),
  ('admin', 'reputation.view'),
  ('admin', 'property_info.view'),
  ('admin', 'website_manager.view'),
  ('admin', 'website_manager.edit'),
  ('admin', 'reports.layout.edit'),
  ('admin', 'notes.view'),
  ('admin', 'tasks.view'),
  ('admin', 'users.manage'),
  ('regional_manager', 'dashboard.view'),
  ('regional_manager', 'reports.view'),
  ('regional_manager', 'analytics.view'),
  ('regional_manager', 'reputation.view'),
  ('regional_manager', 'property_info.view'),
  ('regional_manager', 'website_manager.view'),
  ('regional_manager', 'website_manager.edit'),
  ('regional_manager', 'tasks.view'),
  ('community_manager', 'dashboard.view'),
  ('community_manager', 'analytics.view'),
  ('community_manager', 'website_manager.view'),
  ('community_manager', 'website_manager.edit'),
  ('community_manager', 'tasks.view'),
  ('client', 'reports.view'),
  ('client', 'tasks.view')
on conflict (role, permission) do nothing;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when coalesce(public.profiles.full_name, '') <> '' then public.profiles.full_name
        else excluded.full_name
      end;

  return new;
end;
$$;

create or replace function public.handle_updated_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = new.email,
      full_name = case
        when coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '') <> ''
          then coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
        else public.profiles.full_name
      end
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

create trigger on_auth_user_updated
after update on auth.users
for each row
execute function public.handle_updated_user_profile();

create or replace function public.current_user_global_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select profiles.global_role
  from public.profiles
  where profiles.id = auth.uid()
    and profiles.is_active = true
  limit 1;
$$;

create or replace function public.user_has_platform_permission(target_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    join public.role_permissions
      on public.role_permissions.role = public.profiles.global_role
    where public.profiles.id = auth.uid()
      and public.profiles.is_active = true
      and public.role_permissions.permission = target_permission
  );
$$;

create or replace function public.user_can_access_property(target_property_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_has_platform_permission('properties.view_all')
    or exists (
      select 1
      from public.property_memberships
      where public.property_memberships.user_id = auth.uid()
        and public.property_memberships.property_id = target_property_id
        and public.property_memberships.is_active = true
    );
$$;

create or replace function public.user_has_property_permission(target_property_id text, target_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_has_platform_permission(target_permission)
    or (
      public.user_can_access_property(target_property_id)
      and exists (
        select 1
        from public.property_memberships
        join public.role_permissions
          on public.role_permissions.role = public.property_memberships.role
        where public.property_memberships.user_id = auth.uid()
          and public.property_memberships.property_id = target_property_id
          and public.property_memberships.is_active = true
          and public.role_permissions.permission = target_permission
      )
    );
$$;

create or replace function public.user_property_permissions_for_ids(target_property_ids text[], target_permissions text[])
returns table(property_id text, permissions text[])
language sql
stable
security definer
set search_path = public
as $$
  with requested_properties as (
    select distinct unnest(coalesce(target_property_ids, array[]::text[])) as property_id
  ),
  requested_permissions as (
    select distinct unnest(coalesce(target_permissions, array[]::text[])) as permission
  ),
  allowed as (
    select requested_properties.property_id, requested_permissions.permission
    from requested_properties
    cross join requested_permissions
    where public.user_has_property_permission(requested_properties.property_id, requested_permissions.permission)
  )
  select allowed.property_id, array_agg(allowed.permission order by allowed.permission) as permissions
  from allowed
  group by allowed.property_id;
$$;

alter table public.app_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.property_memberships enable row level security;
alter table public.user_tasks enable row level security;
alter table public.access_audit_logs enable row level security;
alter table public.properties enable row level security;
alter table public.property_reporting_layout_current enable row level security;
alter table public.property_website_manager_current enable row level security;
alter table public.property_daily_snapshots enable row level security;
alter table public.property_leads enable row level security;
alter table public.property_events enable row level security;
alter table public.property_invoices enable row level security;
alter table public.property_availability enable row level security;
alter table public.property_specials_current enable row level security;
alter table public.property_availability_snapshots enable row level security;
alter table public.property_leases enable row level security;
alter table public.property_roi_daily enable row level security;
alter table public.property_analytics_snapshots enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_retries enable row level security;

drop policy if exists "authenticated users can read roles" on public.app_roles;
create policy "authenticated users can read roles"
on public.app_roles
for select
to authenticated
using (true);

drop policy if exists "authenticated users can read role permissions" on public.role_permissions;
create policy "authenticated users can read role permissions"
on public.role_permissions
for select
to authenticated
using (true);

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "users can update own profile basics" on public.profiles;
create policy "users can update own profile basics"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "authenticated users can read profile avatars" on storage.objects;
create policy "authenticated users can read profile avatars"
on storage.objects
for select
to authenticated
using (bucket_id = 'profile-avatars');

drop policy if exists "users can upload own profile avatars" on storage.objects;
create policy "users can upload own profile avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can update own profile avatars" on storage.objects;
create policy "users can update own profile avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can delete own profile avatars" on storage.objects;
create policy "users can delete own profile avatars"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "users can read own memberships" on public.property_memberships;
create policy "users can read own memberships"
on public.property_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.user_has_platform_permission('users.manage')
);

drop policy if exists "admins manage memberships" on public.property_memberships;
create policy "admins manage memberships"
on public.property_memberships
for all
to authenticated
using (public.user_has_platform_permission('users.manage'))
with check (public.user_has_platform_permission('users.manage'));

drop policy if exists "users can read own tasks" on public.user_tasks;
create policy "users can read own tasks"
on public.user_tasks
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "users can create own tasks for active properties" on public.user_tasks;
create policy "users can create own tasks for active properties"
on public.user_tasks
for insert
to authenticated
with check (
  owner_user_id = auth.uid()
  and public.user_can_access_property(property_id)
);

drop policy if exists "users can update own tasks for active properties" on public.user_tasks;
create policy "users can update own tasks for active properties"
on public.user_tasks
for update
to authenticated
using (owner_user_id = auth.uid())
with check (
  owner_user_id = auth.uid()
  and public.user_can_access_property(property_id)
);

drop policy if exists "users can delete own tasks" on public.user_tasks;
create policy "users can delete own tasks"
on public.user_tasks
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "admins can read access audit logs" on public.access_audit_logs;
create policy "admins can read access audit logs"
on public.access_audit_logs
for select
to authenticated
using (public.user_has_platform_permission('users.manage'));

drop policy if exists "users can read accessible properties" on public.properties;
create policy "users can read accessible properties"
on public.properties
for select
to authenticated
using (public.user_can_access_property(id));

drop policy if exists "users can read reporting layouts for accessible properties" on public.property_reporting_layout_current;
create policy "users can read reporting layouts for accessible properties"
on public.property_reporting_layout_current
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "users can edit reporting layouts for allowed properties" on public.property_reporting_layout_current;
create policy "users can edit reporting layouts for allowed properties"
on public.property_reporting_layout_current
for all
to authenticated
using (public.user_has_property_permission(property_id, 'reports.layout.edit'))
with check (public.user_has_property_permission(property_id, 'reports.layout.edit'));

drop policy if exists "users can read website manager rows for accessible properties" on public.property_website_manager_current;
create policy "users can read website manager rows for accessible properties"
on public.property_website_manager_current
for select
to authenticated
using (public.user_has_property_permission(property_id, 'website_manager.view'));

drop policy if exists "users can edit website manager rows for allowed properties" on public.property_website_manager_current;
create policy "users can edit website manager rows for allowed properties"
on public.property_website_manager_current
for all
to authenticated
using (public.user_has_property_permission(property_id, 'website_manager.edit'))
with check (public.user_has_property_permission(property_id, 'website_manager.edit'));

drop policy if exists "users can read daily property snapshots they can access" on public.property_daily_snapshots;
create policy "users can read daily property snapshots they can access"
on public.property_daily_snapshots
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'dashboard.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read property leads they can access" on public.property_leads;
create policy "users can read property leads they can access"
on public.property_leads
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'dashboard.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read property events they can access" on public.property_events;
create policy "users can read property events they can access"
on public.property_events
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'dashboard.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read property invoices they can access" on public.property_invoices;
create policy "users can read property invoices they can access"
on public.property_invoices
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'dashboard.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read property availability they can access" on public.property_availability;
create policy "users can read property availability they can access"
on public.property_availability
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'dashboard.view')
  or public.user_has_property_permission(property_id, 'reports.view')
);

drop policy if exists "users can read property specials they can access" on public.property_specials_current;
create policy "users can read property specials they can access"
on public.property_specials_current
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "users can read property pricing snapshots they can access" on public.property_availability_snapshots;
create policy "users can read property pricing snapshots they can access"
on public.property_availability_snapshots
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "users can read property leases they can access" on public.property_leases;
create policy "users can read property leases they can access"
on public.property_leases
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "users can read property roi they can access" on public.property_roi_daily;
create policy "users can read property roi they can access"
on public.property_roi_daily
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "users can read analytics snapshots they can access" on public.property_analytics_snapshots;
create policy "users can read analytics snapshots they can access"
on public.property_analytics_snapshots
for select
to authenticated
using (
  public.user_has_property_permission(property_id, 'analytics.view')
  or public.user_has_property_permission(property_id, 'reputation.view')
);

drop policy if exists "authenticated users can read sync state" on public.sync_state;
create policy "authenticated users can read sync state"
on public.sync_state
for select
to authenticated
using (true);

drop policy if exists "authenticated users can read sync retries" on public.sync_retries;
create policy "authenticated users can read sync retries"
on public.sync_retries
for select
to authenticated
using (true);
