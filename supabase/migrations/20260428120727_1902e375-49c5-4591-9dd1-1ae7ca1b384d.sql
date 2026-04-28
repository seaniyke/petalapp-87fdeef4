-- Live Preview Share + comments
create table if not exists public.preview_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token text not null unique,
  created_by uuid not null,
  allow_comments boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_preview_shares_project on public.preview_shares(project_id);
create index if not exists idx_preview_shares_token on public.preview_shares(token);

alter table public.preview_shares enable row level security;

-- Owners manage their shares
create policy "Owners can view their shares"
on public.preview_shares for select
to authenticated
using (created_by = auth.uid());

create policy "Owners can create shares"
on public.preview_shares for insert
to authenticated
with check (created_by = auth.uid());

create policy "Owners can update their shares"
on public.preview_shares for update
to authenticated
using (created_by = auth.uid());

create policy "Owners can delete their shares"
on public.preview_shares for delete
to authenticated
using (created_by = auth.uid());

-- Public lookup by token (needed by share page to validate)
create policy "Public can read shares by token"
on public.preview_shares for select
to anon
using (revoked_at is null and (expires_at is null or expires_at > now()));

-- Comments
create table if not exists public.preview_comments (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.preview_shares(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_path text not null default '/',
  selector text,
  x_pct numeric,
  y_pct numeric,
  body text not null,
  viewport_width int,
  author_name text,
  status text not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_preview_comments_project on public.preview_comments(project_id);
create index if not exists idx_preview_comments_share on public.preview_comments(share_id);

alter table public.preview_comments enable row level security;

-- Owners can read all comments on their projects
create policy "Owners can read comments on their projects"
on public.preview_comments for select
to authenticated
using (
  exists (
    select 1 from public.preview_shares s
    where s.id = preview_comments.share_id
      and s.created_by = auth.uid()
  )
);

-- Owners can resolve / update comments
create policy "Owners can update comments on their projects"
on public.preview_comments for update
to authenticated
using (
  exists (
    select 1 from public.preview_shares s
    where s.id = preview_comments.share_id
      and s.created_by = auth.uid()
  )
);

create policy "Owners can delete comments on their projects"
on public.preview_comments for delete
to authenticated
using (
  exists (
    select 1 from public.preview_shares s
    where s.id = preview_comments.share_id
      and s.created_by = auth.uid()
  )
);

-- Anyone with a valid share token can post a comment (validated via share lookup)
create policy "Anyone with valid share can post comments"
on public.preview_comments for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.preview_shares s
    where s.id = preview_comments.share_id
      and s.project_id = preview_comments.project_id
      and s.allow_comments = true
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  )
);

-- Realtime so the builder sees comments as they land
alter publication supabase_realtime add table public.preview_comments;