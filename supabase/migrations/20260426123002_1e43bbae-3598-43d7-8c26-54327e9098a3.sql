create table public.project_backends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null default 'byo_supabase'
    check (provider in ('byo_supabase','managed_supabase')),
  status text not null default 'ready'
    check (status in ('connecting','ready','failed','paused')),
  supabase_url text not null,
  anon_key text not null,
  service_role_key text,
  health_checked_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (project_id)
);

alter table public.project_backends enable row level security;

create policy "Owners view their backend"
  on public.project_backends for select
  using (exists (select 1 from public.projects p
                 where p.id = project_backends.project_id and p.owner_id = auth.uid()));

create policy "Owners can connect a backend"
  on public.project_backends for insert
  with check (exists (select 1 from public.projects p
                      where p.id = project_backends.project_id and p.owner_id = auth.uid()));

create policy "Owners can update their backend"
  on public.project_backends for update
  using (exists (select 1 from public.projects p
                 where p.id = project_backends.project_id and p.owner_id = auth.uid()));

create policy "Owners can disconnect their backend"
  on public.project_backends for delete
  using (exists (select 1 from public.projects p
                 where p.id = project_backends.project_id and p.owner_id = auth.uid()));