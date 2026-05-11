create extension if not exists pgcrypto;

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null default gen_random_uuid(),
  property_id text not null references public.properties(id) on delete cascade,
  generated_by_user_id uuid references auth.users(id) on delete set null,
  prompt_version text not null,
  model text not null,
  date_range_start date,
  date_range_end date,
  source_context_summary jsonb not null default '{}'::jsonb,
  source_context_snapshot jsonb not null default '{}'::jsonb,
  generation_summary text not null default '',
  recommendation_payload jsonb not null default '{}'::jsonb,
  title text not null,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  category text not null default 'general',
  status text not null default 'new' check (status in ('new', 'approved', 'dismissed')),
  task_id uuid,
  implementation_status text not null default 'not_started' check (implementation_status in ('not_started', 'task_created', 'in_progress', 'complete', 'worked', 'did_not_move_metric', 'inconclusive')),
  implementation_review_payload jsonb not null default '{}'::jsonb,
  implementation_reviewed_at timestamptz,
  latest_feedback_type text,
  useful_count integer not null default 0,
  not_useful_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_recommendations
add column if not exists source_context_snapshot jsonb not null default '{}'::jsonb,
add column if not exists task_id uuid,
add column if not exists implementation_status text not null default 'not_started',
add column if not exists implementation_review_payload jsonb not null default '{}'::jsonb,
add column if not exists implementation_reviewed_at timestamptz;

alter table public.ai_recommendations
drop constraint if exists ai_recommendations_implementation_status_check;

alter table public.ai_recommendations
add constraint ai_recommendations_implementation_status_check
check (implementation_status in ('not_started', 'task_created', 'in_progress', 'complete', 'worked', 'did_not_move_metric', 'inconclusive'));

create index if not exists idx_ai_recommendations_property_created
  on public.ai_recommendations (property_id, created_at desc);

create index if not exists idx_ai_recommendations_generation
  on public.ai_recommendations (generation_id);

create index if not exists idx_ai_recommendations_task
  on public.ai_recommendations (task_id);

drop trigger if exists set_ai_recommendations_updated_at on public.ai_recommendations;
create trigger set_ai_recommendations_updated_at
before update on public.ai_recommendations
for each row
execute function public.set_updated_at();

create table if not exists public.ai_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.ai_recommendations(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  feedback_type text not null check (feedback_type in ('approve', 'dismiss', 'useful', 'not_useful')),
  is_useful boolean,
  notes text not null default '',
  feedback_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.user_tasks
add column if not exists recommendation_id uuid references public.ai_recommendations(id) on delete set null,
add column if not exists recommendation_snapshot jsonb not null default '{}'::jsonb;

create index if not exists idx_user_tasks_recommendation
  on public.user_tasks (recommendation_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_recommendations_task_id_fkey'
  ) then
    alter table public.ai_recommendations
    add constraint ai_recommendations_task_id_fkey
    foreign key (task_id) references public.user_tasks(id) on delete set null;
  end if;
end $$;

create index if not exists idx_ai_recommendation_feedback_recommendation_created
  on public.ai_recommendation_feedback (recommendation_id, created_at desc);

create index if not exists idx_ai_recommendation_feedback_property_created
  on public.ai_recommendation_feedback (property_id, created_at desc);

alter table public.ai_recommendations enable row level security;
alter table public.ai_recommendation_feedback enable row level security;

drop policy if exists "users can read ai recommendations they can report on" on public.ai_recommendations;
create policy "users can read ai recommendations they can report on"
on public.ai_recommendations
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "service manages ai recommendations" on public.ai_recommendations;
create policy "service manages ai recommendations"
on public.ai_recommendations
for all
to service_role
using (true)
with check (true);

drop policy if exists "users can read ai feedback they can report on" on public.ai_recommendation_feedback;
create policy "users can read ai feedback they can report on"
on public.ai_recommendation_feedback
for select
to authenticated
using (public.user_has_property_permission(property_id, 'reports.view'));

drop policy if exists "service manages ai feedback" on public.ai_recommendation_feedback;
create policy "service manages ai feedback"
on public.ai_recommendation_feedback
for all
to service_role
using (true)
with check (true);
