# Plan — Wire the managed-backend migration runner

## Why

Today, when Petal generates a backend feature ("add a dashboard", "add auth", "add a recipes table"), the model emits files into `project_files` — including `supabase/migrations/*.sql` — but **nothing ever applies that SQL against the user's managed Supabase project**. The Cloud panel (Database / Users) then correctly shows "no tables, no users", and the user feels lied to. The recap text used to make it worse by claiming "I created the users table" — that's now suppressed by `backend-claim-guard.ts`, but the underlying gap remains.

This plan wires the actual runner so that emitted migrations are executed against the project's managed Supabase, surfaced in the chat, and reflected in the Cloud panel.

## Scope (this plan only)

In:
- Detect newly emitted `supabase/migrations/*.sql` files at the end of a generate turn.
- Execute them, in order, against the project's managed Postgres using stored credentials.
- Track which migrations have already been applied (idempotency) so re-runs are safe.
- Surface success / failure in the chat (replaces the current silent skip and the suppressed false claim).
- Refresh the Cloud panel data so the new tables/users show up.

Out (follow-ups, not this plan):
- Auto-generating migrations from natural language (the model already does this when prompted; we're only running what it emits).
- A full migration UI (rollback, squash, edit). For now: append-only, applied in filename order.
- Storage buckets / edge function deploys triggered from migrations.

## Architecture

### 1. New table: `project_backend_migrations`

Tracks which `supabase/migrations/*.sql` files have been applied to which project's managed backend.

```sql
create table public.project_backend_migrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  migration_path text not null,          -- e.g. "supabase/migrations/20260501120000_recipes.sql"
  content_hash text not null,            -- sha256 of file content at apply time
  applied_at timestamptz not null default now(),
  applied_status text not null,          -- 'success' | 'failed'
  error_message text,
  unique (project_id, migration_path)
);
alter table public.project_backend_migrations enable row level security;
create policy "Owners read their migration history"
  on public.project_backend_migrations for select
  using (exists (select 1 from public.projects p
                 where p.id = project_id and p.owner_id = auth.uid()));
-- Writes are server-only (service role bypasses RLS).
```

Why hash the content: if the model regenerates the same filename with different SQL, we treat it as a new migration that needs applying (we'll append, not retry — see "Failure model").

### 2. New runner: `src/server/managed-migrations.server.ts`

```ts
export async function applyPendingMigrations(projectId: string): Promise<{
  applied: { path: string }[];
  skipped: { path: string; reason: "already-applied" }[];
  failed: { path: string; error: string } | null;  // first failure stops the run
}>
```

Steps:
1. Look up `project_backends` row. If `provider !== 'managed_petal'` or `status !== 'ready'`, return `{ applied: [], skipped: [], failed: null }` (nothing to do — the user doesn't have a managed backend yet).
2. Read all `project_files` where `path LIKE 'supabase/migrations/%.sql'`, ordered by `path` (filenames are timestamp-prefixed).
3. Diff against `project_backend_migrations` for this project. A file is "pending" if `(project_id, migration_path)` isn't in the table OR the stored `content_hash` differs from the current hash.
4. For each pending file, in order:
   - Execute the SQL using the Supabase Management API's "Run query" endpoint (`POST /v1/projects/{ref}/database/query`) with the access token from `SUPABASE_MGMT_API_TOKEN`. This is the same surface `supabase-mgmt.server.ts` already uses, so no new auth plumbing.
   - On success: insert a row into `project_backend_migrations` with `applied_status='success'`.
   - On failure: insert with `applied_status='failed'` + `error_message`, then **stop** (don't apply later migrations on top of a broken DB). Return `failed`.
5. Return the summary.

Why the Mgmt API and not a direct `pg` connection from the Worker: the Worker SSR runtime doesn't ship `pg` cleanly, and we already have the Mgmt token wired for project provisioning. Mgmt API "Run query" supports arbitrary SQL with service-role-equivalent privileges.

### 3. Hook into the generate pipeline

In `src/server/generate.server.ts`, at the end of a successful turn (right after files are written and before the recap is finalized):

- Call `applyPendingMigrations(projectId)`.
- Append the result to the chat as a structured assistant message (uses the existing `STRUCTURED_PREFIX` JSON envelope already extended for `error`):
  - All success → "Applied N database changes to your backend." (small inline summary card)
  - Partial → "Applied N changes. The next one (`<path>`) failed: <error>. Fix it in chat and I'll retry."
  - Nothing pending → no message.
- Drop the corresponding sentence from `backend-claim-guard.ts`'s strip list **only when** `applyPendingMigrations` reports success — i.e. the guard now consults the runner's result instead of just file presence. Concretely: `emittedRealBackend(files)` becomes `appliedRealBackend(projectId, runResult)`.

### 4. Surface in the Cloud panel

`CloudDatabaseView.tsx` and `CloudUsersView.tsx` already query the live managed Supabase via `cloud-database.functions.ts` / `cloud-users.functions.ts`. After the migration runs, those endpoints will naturally return the new tables/rows. The only UI change:

- Add a "Migration history" small section under the Database view, sourced from `project_backend_migrations` (last 10, with status pill). This makes "what did Petal actually run?" answerable without leaving the panel.
- Replace the "no tables yet — ask Petal" empty state CTA with a smarter version: if `project_backend_migrations` has any `failed` row, show that error inline with a "Retry" button that calls a new server fn `retryFailedMigrations(projectId)` (just calls `applyPendingMigrations` again).

### 5. Failure model

- Migrations are append-only. We never re-run a `success` row. If the model regenerates the same filename with different SQL, we treat it as a **new pending migration** (because the hash changed) and apply it on top. The model is responsible for writing forward-compatible SQL (`alter table ... add column if not exists`, etc.) — the system prompt in `generate.server.ts` already nudges this; we'll add a one-line reinforcement.
- A `failed` migration blocks all later ones for that project until either (a) the user asks Petal to fix it (next turn emits a new migration with a later timestamp that supersedes it), or (b) the user clicks Retry in the Cloud panel after manually fixing state.
- We never run destructive SQL silently — but we also don't try to parse SQL to classify it. The user's project, the user's data; Petal does what it's told.

## Files to add / change

New:
- `supabase/migrations/<ts>_project_backend_migrations.sql` (the table above)
- `src/server/managed-migrations.server.ts` (runner)
- `src/server/managed-migrations.functions.ts` (server fn: `retryFailedMigrations`, `listMigrationHistory`)
- `src/components/cloud/CloudMigrationHistory.tsx` (small list inside the Database view)

Changed:
- `src/server/generate.server.ts` — call runner, append structured chat message
- `src/server/integrations/installer.server.ts` — replace the "Migration runner not wired yet — skipping." stub with a call into the new runner (so paid integrations like Resend that ship a migration also benefit)
- `src/lib/backend-claim-guard.ts` — accept a `migrationRunResult` and only strip claims if no migration was actually applied this turn
- `src/components/cloud/CloudDatabaseView.tsx` — mount `<CloudMigrationHistory />` and the "failed migration" inline error+Retry

## Rollout

1. Ship the table + runner behind a per-project feature check (`labs_flags.managed_migrations_enabled`, default off).
2. Enable for the reporting user's project first, watch one real generate turn end-to-end via `pipeline_telemetry`.
3. Flip the default to on once we've seen a clean success and a clean failure (induced) round-trip.

## Open questions (worth confirming before implementing)

- Mgmt API rate limits on "Run query" — fine for our volume but worth a 1-line guard (sequential per project, no parallel runs for the same `project_id`).
- Should the runner also pick up `supabase/seed.sql` if present? Leaning **no** for v1 — seeds are easy to make destructive on re-run. Revisit when a user asks.
