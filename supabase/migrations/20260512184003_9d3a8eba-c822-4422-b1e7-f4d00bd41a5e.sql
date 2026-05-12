create table if not exists public.petal_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null,
  payload jsonb not null,
  status text not null default 'proposed' check (status in ('proposed','approved','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists petal_plans_user_idx on public.petal_plans (user_id, created_at desc);
create index if not exists petal_plans_project_idx on public.petal_plans (project_id, created_at desc);

alter table public.petal_plans enable row level security;

create policy "users read own plans"
  on public.petal_plans for select
  using (auth.uid() = user_id);

create policy "users insert own plans"
  on public.petal_plans for insert
  with check (auth.uid() = user_id);

create policy "users update own plans"
  on public.petal_plans for update
  using (auth.uid() = user_id);