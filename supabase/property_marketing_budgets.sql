-- Approved property marketing budget items and contract attachments.
-- Apply after firestore_first_pass_schema.sql and auth_access_model.sql.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-marketing-contracts',
  'property-marketing-contracts',
  false,
  15728640,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.property_marketing_budget_items (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'active', 'inactive', 'past')),
  item_name text not null,
  monthly_amount numeric(14,2) not null default 0 check (monthly_amount >= 0),
  start_date date not null,
  end_date date,
  listing_url text,
  contract_file_name text,
  contract_storage_path text,
  contract_mime_type text,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_marketing_budget_items_property_status
  on public.property_marketing_budget_items (property_id, status, start_date desc);

create index if not exists idx_property_marketing_budget_items_updated
  on public.property_marketing_budget_items (updated_at desc);

drop trigger if exists set_property_marketing_budget_items_updated_at on public.property_marketing_budget_items;
create trigger set_property_marketing_budget_items_updated_at
before update on public.property_marketing_budget_items
for each row
execute function public.set_updated_at();

alter table public.property_marketing_budget_items enable row level security;

drop policy if exists "users can read property marketing budgets they can access" on public.property_marketing_budget_items;
create policy "users can read property marketing budgets they can access"
on public.property_marketing_budget_items
for select
to authenticated
using (public.user_has_property_permission(property_id, 'property_info.view'));

drop policy if exists "users can edit property marketing budgets they can access" on public.property_marketing_budget_items;
create policy "users can edit property marketing budgets they can access"
on public.property_marketing_budget_items
for all
to authenticated
using (public.user_has_property_permission(property_id, 'property_info.view'))
with check (public.user_has_property_permission(property_id, 'property_info.view'));

drop policy if exists "users can read property marketing contracts they can access" on storage.objects;
create policy "users can read property marketing contracts they can access"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'property-marketing-contracts'
  and public.user_has_property_permission((storage.foldername(name))[1], 'property_info.view')
);

drop policy if exists "users can upload property marketing contracts they can access" on storage.objects;
create policy "users can upload property marketing contracts they can access"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'property-marketing-contracts'
  and public.user_has_property_permission((storage.foldername(name))[1], 'property_info.view')
);

drop policy if exists "users can update property marketing contracts they can access" on storage.objects;
create policy "users can update property marketing contracts they can access"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'property-marketing-contracts'
  and public.user_has_property_permission((storage.foldername(name))[1], 'property_info.view')
)
with check (
  bucket_id = 'property-marketing-contracts'
  and public.user_has_property_permission((storage.foldername(name))[1], 'property_info.view')
);

drop policy if exists "users can delete property marketing contracts they can access" on storage.objects;
create policy "users can delete property marketing contracts they can access"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'property-marketing-contracts'
  and public.user_has_property_permission((storage.foldername(name))[1], 'property_info.view')
);
