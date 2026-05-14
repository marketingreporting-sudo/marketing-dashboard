-- Ticket intake and task assignment model.
-- Apply after supabase/auth_access_model.sql.

create extension if not exists pgcrypto;

alter table public.user_tasks
  alter column owner_user_id drop not null,
  alter column property_id drop not null,
  add column if not exists ticket_id uuid,
  add column if not exists assigned_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists source text not null default 'manual',
  add column if not exists priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists requester_email text;

create index if not exists idx_user_tasks_ticket
  on public.user_tasks (ticket_id);

alter table public.user_tasks
  drop constraint if exists user_tasks_priority_check;

alter table public.user_tasks
  add constraint user_tasks_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));

create table if not exists public.property_ticket_assignments (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  default_assignee_user_id uuid references auth.users(id) on delete set null,
  regional_user_id uuid references auth.users(id) on delete set null,
  client_group_portfolio text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id)
);

alter table public.property_ticket_assignments
  alter column default_assignee_user_id drop not null,
  add column if not exists regional_user_id uuid references auth.users(id) on delete set null,
  add column if not exists client_group_portfolio text;

create index if not exists idx_property_ticket_assignments_assignee
  on public.property_ticket_assignments (default_assignee_user_id, is_active);

create index if not exists idx_property_ticket_assignments_regional
  on public.property_ticket_assignments (regional_user_id, is_active);

drop trigger if exists set_property_ticket_assignments_updated_at on public.property_ticket_assignments;
create trigger set_property_ticket_assignments_updated_at
before update on public.property_ticket_assignments
for each row
execute function public.set_updated_at();

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.user_tasks(id) on delete set null,
  property_id text references public.properties(id) on delete restrict,
  requester_user_id uuid references auth.users(id) on delete set null,
  requester_email text,
  submitted_by_user_id uuid references auth.users(id) on delete set null,
  submitted_by_email text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'dashboard_form' check (source in ('dashboard_form', 'forwarded_email', 'outlook_email', 'admin_created')),
  category text not null default 'general',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (status in (
    'new',
    'in_progress',
    'on_hold',
    'awaiting_approval',
    'approved',
    'complete'
  )),
  title text not null,
  description text not null default '',
  due_at timestamptz,
  email_message_id text,
  email_subject text,
  email_from text,
  email_to text,
  email_excerpt text,
  original_email_message_id text,
  original_email_subject text,
  original_email_from text,
  original_email_body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_due_at_minimum check (
    due_at is null
    or due_at >= created_at + interval '24 hours'
  )
);

alter table public.tickets
  alter column property_id drop not null,
  add column if not exists task_id uuid references public.user_tasks(id) on delete set null,
  add column if not exists requester_email text,
  add column if not exists submitted_by_email text,
  add column if not exists submitted_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists source text not null default 'dashboard_form',
  add column if not exists original_email_message_id text,
  add column if not exists original_email_subject text,
  add column if not exists original_email_from text,
  add column if not exists original_email_body text;

alter table public.tickets
  drop constraint if exists tickets_source_check;

alter table public.tickets
  add constraint tickets_source_check
  check (source in ('dashboard_form', 'forwarded_email', 'outlook_email', 'admin_created'));

create index if not exists idx_tickets_property_status
  on public.tickets (property_id, status, updated_at desc);

create index if not exists idx_tickets_assigned_status
  on public.tickets (assigned_user_id, status, updated_at desc);

create index if not exists idx_tickets_submitted_by
  on public.tickets (submitted_by_user_id, created_at desc);

create index if not exists idx_tickets_email_message_id
  on public.tickets (email_message_id)
  where email_message_id is not null;

create unique index if not exists idx_tickets_original_email_message_id
  on public.tickets (original_email_message_id)
  where original_email_message_id is not null;

drop trigger if exists set_tickets_updated_at on public.tickets;
create trigger set_tickets_updated_at
before update on public.tickets
for each row
execute function public.set_updated_at();

create table if not exists public.ticket_activity_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ticket_activity_log_ticket
  on public.ticket_activity_log (ticket_id, created_at desc);

insert into public.role_permissions (role, permission)
values
  ('admin', 'tickets.submit'),
  ('admin', 'tickets.view_property'),
  ('admin', 'tickets.assign'),
  ('admin', 'tickets.manage'),
  ('regional_manager', 'tickets.submit'),
  ('regional_manager', 'tickets.view_property'),
  ('regional_manager', 'tickets.assign'),
  ('community_manager', 'tickets.submit'),
  ('community_manager', 'tickets.view_property'),
  ('client', 'tickets.submit')
on conflict (role, permission) do nothing;

alter table public.property_ticket_assignments enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_activity_log enable row level security;

drop policy if exists "users can read ticket assignments for accessible properties" on public.property_ticket_assignments;
create policy "users can read ticket assignments for accessible properties"
on public.property_ticket_assignments
for select
to authenticated
using (public.user_can_access_property(property_id));

drop policy if exists "admins manage ticket assignments" on public.property_ticket_assignments;
create policy "admins manage ticket assignments"
on public.property_ticket_assignments
for all
to authenticated
using (public.user_has_platform_permission('users.manage'))
with check (public.user_has_platform_permission('users.manage'));

drop policy if exists "users can read related tickets" on public.tickets;
create policy "users can read related tickets"
on public.tickets
for select
to authenticated
using (
  submitted_by_user_id = auth.uid()
  or requester_user_id = auth.uid()
  or assigned_user_id = auth.uid()
  or public.user_has_property_permission(property_id, 'tickets.view_property')
  or public.user_has_platform_permission('tickets.manage')
);

drop policy if exists "users can submit tickets for accessible properties" on public.tickets;
create policy "users can submit tickets for accessible properties"
on public.tickets
for insert
to authenticated
with check (
  submitted_by_user_id = auth.uid()
  and public.user_has_property_permission(property_id, 'tickets.submit')
);

drop policy if exists "assigned users and managers can update tickets" on public.tickets;
create policy "assigned users and managers can update tickets"
on public.tickets
for update
to authenticated
using (
  assigned_user_id = auth.uid()
  or public.user_has_property_permission(property_id, 'tickets.assign')
  or public.user_has_platform_permission('tickets.manage')
)
with check (
  assigned_user_id = auth.uid()
  or public.user_has_property_permission(property_id, 'tickets.assign')
  or public.user_has_platform_permission('tickets.manage')
);

drop policy if exists "users can read related ticket activity" on public.ticket_activity_log;
create policy "users can read related ticket activity"
on public.ticket_activity_log
for select
to authenticated
using (
  exists (
    select 1
    from public.tickets
    where public.tickets.id = ticket_activity_log.ticket_id
      and (
        public.tickets.submitted_by_user_id = auth.uid()
        or public.tickets.requester_user_id = auth.uid()
        or public.tickets.assigned_user_id = auth.uid()
        or public.user_has_property_permission(public.tickets.property_id, 'tickets.view_property')
        or public.user_has_platform_permission('tickets.manage')
      )
  )
);

drop policy if exists "service users can write ticket activity" on public.ticket_activity_log;
create policy "service users can write ticket activity"
on public.ticket_activity_log
for insert
to authenticated
with check (
  exists (
    select 1
    from public.tickets
    where public.tickets.id = ticket_activity_log.ticket_id
      and (
        public.tickets.assigned_user_id = auth.uid()
        or public.tickets.submitted_by_user_id = auth.uid()
        or public.user_has_property_permission(public.tickets.property_id, 'tickets.assign')
        or public.user_has_platform_permission('tickets.manage')
      )
  )
);
