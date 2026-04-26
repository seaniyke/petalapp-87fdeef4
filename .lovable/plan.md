# Base44-style "Add Backend" for Petal

Silently provision a real backend (auth + database + storage) per generated app, and inject pre-configured client credentials into the project's source so the AI can write `supabase.from(...)`, `supabase.auth.signIn(...)`, and `supabase.storage.from(...)` immediately — no user setup, no copy-paste, no env vars to fill in.

This mirrors how Base44 / Lovable Cloud feel from the user's perspective, while keeping ops realistic by using the **Supabase Management API** under the hood. We do not build our own Postgres/auth stack — that path is months of work and on-call duty for a side project.

---

## 1. Operational model (read first — this is the load-bearing decision)

- A single **Supabase organization that you own** hosts every Petal user's backend as a separate Supabase **project**.
- The Petal server holds one secret: `SUPABASE_MANAGEMENT_TOKEN` (a Personal Access Token scoped to that org).
- When a user clicks "Add Backend", Petal calls the Supabase Management API to create a fresh project, then stores its URL + anon key + service role key keyed to the Petal `projects.id`.
- The generated app gets those credentials baked into `src/integrations/backend/client.ts` at build time. The end user never sees them as "Supabase".
- Cost reality: free-tier Supabase orgs allow only **2 active projects**. To go past two real users you need a Pro org (~$25/mo + per-project compute). This plan ships behind a feature flag so you can pilot without committing.

---

## 2. New database schema (one migration)

Add a `project_backends` table to track each provisioned backend:

```sql
create table public.project_backends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'provisioning'
    check (status in ('provisioning','ready','failed','paused')),
  supabase_project_ref text,           -- e.g. "kbszbczzmjoiiezyifsd"
  supabase_url text,                   -- public, injected into generated app
  anon_key text,                       -- public, injected into generated app
  service_role_key text,               -- SECRET — never sent to client / never injected
  region text default 'us-east-1',
  error_message text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (project_id)
);
alter table public.project_backends enable row level security;

-- Owners can SEE that a backend exists, but never the service_role_key.
-- We enforce this in the server function (no SELECT policy returns service_role_key column to client).
create policy "Owners view their backend status"
  on public.project_backends for select
  using (exists (select 1 from public.projects p
                 where p.id = project_backends.project_id and p.owner_id = auth.uid()));
```

Critically: **`service_role_key` is never returned to client code.** All reads from `useBackend()` go through a server function that strips that column. The column exists only so server functions and edge functions can use it.

---

## 3. Provisioning server function

New file: `src/server/backend-provisioner.server.ts`

- Wraps the Supabase Management API:
  - `POST /v1/projects` to create a project (org_id, name = `petal-<projectId-short>`, db_pass = random, region).
  - Poll `GET /v1/projects/{ref}` until `status === "ACTIVE_HEALTHY"` (typically 60–120s).
  - `GET /v1/projects/{ref}/api-keys` to fetch anon + service_role.
  - `POST /v1/projects/{ref}/database/query` to run a small bootstrap migration (creates `profiles`, `user_roles`, `has_role`, `handle_new_user` trigger — same shape Petal already uses).
  - Enable Auth providers: email/password (default on), and optionally Google OAuth via `PATCH /v1/projects/{ref}/config/auth`.
  - Create a default storage bucket `uploads` (private) via `POST /v1/projects/{ref}/storage/buckets`.

Exposed as two server functions in `src/server/backend-provisioner.server.ts`:

```ts
export const provisionBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { projectId: string }) => i)
  .handler(async ({ data, context }) => { /* … */ });

export const getBackendStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { projectId: string }) => i)
  .handler(async ({ data, context }) => {
    // Returns { status, supabaseUrl, anonKey } — NEVER serviceRoleKey.
  });
```

Provisioning runs async: the function inserts a `project_backends` row with `status='provisioning'`, kicks off the Management API calls in the background (fire-and-forget with logging), and returns immediately. The UI polls `getBackendStatus` every 3s.

---

## 4. Injecting credentials into the generated app

Today `applyScaffoldKit(aiFiles)` in `src/server/scaffold-kit.ts` merges in the static UI kit. Extend it to also merge a **dynamic backend kit** when a backend exists.

New signature:
```ts
export function applyScaffoldKit(
  aiFiles: ProjectFile[],
  opts?: { backend?: { url: string; anonKey: string } }
): ProjectFile[]
```

When `opts.backend` is present, inject these files (all `overwrite: true`, all under `src/components/ui/`-style protected paths so the AI can't break them):

- **`src/integrations/backend/client.ts`** — pre-configured `createClient(url, anonKey)` with localStorage persistence. Hard-coded URL + anon key (these are public values, safe to bake in).
- **`src/integrations/backend/auth.tsx`** — `<AuthProvider>` + `useAuth()` hook (mirrors Petal's own `src/lib/auth.tsx`).
- **`src/integrations/backend/types.ts`** — minimal typed `Database` shape covering `profiles` + `user_roles`. Regenerated whenever the AI runs migrations (out of scope for v1; v1 ships `Database = any`).
- **`src/integrations/backend/storage.ts`** — thin wrapper: `uploadFile(file, path)`, `getPublicUrl(path)`, `listFiles(prefix)`.
- **`README-backend.md`** — short reference for the AI (similar to the new `LAYOUT.md`) describing the exposed surface so it knows to import from `@/integrations/backend/client` instead of writing its own.

Wire-up in `src/routes/api/generate.ts`:
1. After auth, look up `project_backends` for the current project.
2. If `status='ready'`, pass `{ url, anonKey }` to `applyScaffoldKit(...)` (both initial generation and patch flows).
3. Add `src/integrations/backend/` to the `isProtectedPath` list so the AI can never overwrite or delete the injected client.

---

## 5. System prompt updates (`src/server/generate.server.ts`)

Add a new "Backend" section to both `SYSTEM_PROMPT_INITIAL` and `SYSTEM_PROMPT_PATCH`, conditionally appended only when a backend is attached:

> ### Backend (auth + database + storage) is available
> The user's project has an attached backend. Import the pre-configured client:
> `import { supabase } from "@/integrations/backend/client";`
> - Auth: `import { useAuth, AuthProvider } from "@/integrations/backend/auth";`
> - Storage: `import { uploadFile, getPublicUrl } from "@/integrations/backend/storage";`
> NEVER write `createClient(...)` yourself. NEVER hard-code URLs or keys. NEVER import from `@supabase/supabase-js` directly.
> If you need a new table, emit a `// MIGRATION:` comment block describing the SQL — do not try to run it.

The "MIGRATION comment" pattern keeps v1 scope tight: the AI signals intent, but actual schema changes still go through a human-approved flow (see §7).

---

## 6. UI: the "Add Backend" button

Add a single entry point in `src/components/ProjectSettingsSheet.tsx`:

- New section "Backend" with three states:
  - **None**: large `Add Backend` button → calls `provisionBackend({ projectId })`, toasts "Provisioning your backend… (~1 min)".
  - **Provisioning**: spinner + status text, polls `getBackendStatus` every 3s.
  - **Ready**: green check + "Auth, database, and file storage are connected." Plus a small `View tables` link that opens a future built-in inspector (out of scope; for v1 just hide this).

No mention of "Supabase" anywhere in the UI — per Lovable Cloud terminology rules in the system context.

Optionally surface the same button inline in the chat sidebar of `src/routes/builder.tsx` as a one-time prompt the first time the AI generates code that looks like it needs persistence (heuristic: AI emits a `// MIGRATION:` comment or imports anything from `@/integrations/backend/` while no backend is attached). v1 can ship without this — settings sheet is enough.

---

## 7. What's intentionally NOT in v1

To keep this shippable in ~1–2 weeks rather than 2 months:

- **No AI-driven schema migrations.** AI emits `// MIGRATION:` SQL comments; running them is manual. v2: a "Run pending migrations" button in settings that POSTs to `/database/query`.
- **No typed `Database` regeneration.** v1 ships `Database = any`. v2: regenerate types after each migration via Management API.
- **No edge functions in the generated app.** Cloudflare Pages is static; if the AI needs server logic later, that's a separate "Add server functions" feature.
- **No billing/quotas/abuse limits.** Hard-cap at 2 backends total during pilot (free tier limit). Add a feature flag `ENABLE_BACKEND_PROVISIONING` defaulting to `false` so you can gate it to your own account first.
- **No "remove backend" flow.** Pausing/deleting a Supabase project via Management API is a v2 polish.
- **No managed Google OAuth.** Email/password only in v1; Google OAuth in v2 (requires per-project OAuth credentials, which is its own UX problem).

---

## 8. Files touched (concrete list)

**New files:**
- `supabase/migrations/<timestamp>_project_backends.sql` (the table + RLS above)
- `src/server/backend-provisioner.server.ts` (Management API client + 2 server functions)
- `src/server/backend-kit.ts` (the injected `client.ts`/`auth.tsx`/`storage.ts`/`README-backend.md` strings, mirroring `scaffold-kit.ts` style)

**Modified:**
- `src/server/scaffold-kit.ts` — extend `applyScaffoldKit` signature with `opts.backend`.
- `src/routes/api/generate.ts` — look up backend, pass to `applyScaffoldKit`, extend `isProtectedPath` to cover `src/integrations/backend/`.
- `src/server/generate.server.ts` — append conditional "Backend" section to both system prompts.
- `src/components/ProjectSettingsSheet.tsx` — new "Backend" section with provision button + polling status.
- `src/lib/projects.ts` — add `getProjectBackend(projectId)` helper that calls the new server function.

**New secret to add (one-time, manual):**
- `SUPABASE_MANAGEMENT_TOKEN` — Personal Access Token from `https://supabase.com/dashboard/account/tokens`, scoped to your org. I'll prompt for this via `add_secret` after the plan is approved.

---

## 9. Risk callouts

- **Free-tier 2-project cap is hard.** The very first time a third user clicks "Add Backend" you must either upgrade the org to Pro (~$25/mo + ~$10/project compute) or refuse provisioning. Plan the feature flag accordingly.
- **Provisioning takes 60–120 seconds.** UX must communicate this clearly; a hung-looking spinner will feel broken. The polling design above handles it.
- **Service role keys are dynamite.** They're stored in `project_backends.service_role_key` and must never leave the server. The schema and server functions in this plan enforce that, but any future code that reads this table must be reviewed.
- **You become responsible for every user's data.** A bug in the AI's generated SQL, an RLS hole, or a Supabase outage all become Petal's problem from the user's perspective. v1 should ship with a visible "Beta — your data lives in a Petal-managed backend" banner.

---

## 10. Suggested approval path

If you approve this plan, the implementation order is:
1. Add the `SUPABASE_MANAGEMENT_TOKEN` secret.
2. Run the migration for `project_backends`.
3. Build `backend-provisioner.server.ts` and test end-to-end against your own Supabase org with a throwaway project.
4. Add `backend-kit.ts` + wire into `applyScaffoldKit`.
5. Update prompts + protected paths.
6. Add the Settings UI.
7. Generate a test project, click "Add Backend", confirm the AI writes working `supabase.from(...)` code on the next turn.
