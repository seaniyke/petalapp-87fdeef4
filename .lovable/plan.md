# Hybrid backend: BYO now, Managed later

## Why hybrid (and why this order)

- **BYO first** = zero infra cost, zero on-call, no Supabase Pro org needed. Ships in ~1 week.
- **Managed later** = same generated-app surface, just a different provisioner. Layer on top once you have ~50+ projects and real signal.

The load-bearing decision is the **abstraction**: every generated app imports from `@/integrations/backend/*`, never from `@supabase/supabase-js` directly. Whether the credentials came from the user's own Supabase project (v1) or a Petal-provisioned one (v2) is invisible to the AI and to the generated code. **Generated apps written today keep working when we flip to managed mode tomorrow.**

---

## v1 scope (what we ship now)

### 1. User flow
1. In a Petal project, user opens Settings → "Backend" → clicks **Connect a backend**.
2. We show a 3-field form:
   - Supabase project URL (`https://xxx.supabase.co`)
   - Supabase anon/publishable key
   - Supabase service role key (optional, server-only, used later for migrations)
3. We validate by hitting `${url}/auth/v1/health` with the anon key and store the result.
4. From the next AI generation onward, `@/integrations/backend/*` is injected with their credentials baked in. AI starts writing `supabase.from(...)`, `useAuth()`, `uploadFile(...)`.

No OAuth in v1 — a paste-form is faster to ship and works for technical users. We add Supabase OAuth in v1.5 once the abstraction has shaken out.

### 2. New table: `project_backends`

```sql
create table public.project_backends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text not null default 'byo_supabase'
    check (provider in ('byo_supabase','managed_supabase')),  -- v2 adds 'managed_supabase'
  status text not null default 'ready'
    check (status in ('connecting','ready','failed','paused')),
  supabase_url text not null,
  anon_key text not null,                  -- public, safe to inject into generated app
  service_role_key text,                   -- SECRET — never returned to client
  health_checked_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (project_id)
);
alter table public.project_backends enable row level security;

-- Owners can SEE that a backend exists.
-- service_role_key is stripped at the server-function boundary, never via SELECT.
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
```

The `provider` enum is what makes managed-mode-later painless: same table, same shape, same downstream code, just a new value.

### 3. New server module: `src/server/backend-connector.server.ts`

Three server functions, all behind `requireSupabaseAuth`:

- **`connectByoBackend({ projectId, supabaseUrl, anonKey, serviceRoleKey? })`**
  - Validates URL shape (`https://*.supabase.co`).
  - Calls `${supabaseUrl}/auth/v1/health` with the anon key as bearer; expects 200.
  - Verifies project ownership.
  - Upserts a `project_backends` row with `provider='byo_supabase'`, `status='ready'`.
  - Returns `{ status, supabaseUrl, anonKey }` — never service_role_key.

- **`getBackendStatus({ projectId })`**
  - Returns `{ status, provider, supabaseUrl, anonKey } | null`. Strips service_role_key.

- **`disconnectBackend({ projectId })`**
  - Deletes the row. Generated app loses the injected client on next AI turn.

This file is where managed-mode hooks in later: a future `provisionManagedBackend(...)` writes to the same table with `provider='managed_supabase'`, and everything downstream is unchanged.

### 4. New module: `src/server/backend-kit.ts`

Mirrors `scaffold-kit.ts` style — a list of file blobs with `overwrite: true` that get merged in. Files injected into every generated app **only when a backend is connected**:

- **`src/integrations/backend/client.ts`** — pre-configured `createClient(url, anonKey)` with localStorage persistence. URL + anon key hard-coded at injection time (these are public values, safe).
- **`src/integrations/backend/auth.tsx`** — `<AuthProvider>` + `useAuth()` hook (mirrors Petal's own `src/lib/auth.tsx`).
- **`src/integrations/backend/storage.ts`** — `uploadFile(file, bucket, path)`, `getPublicUrl(bucket, path)`, `listFiles(bucket, prefix)`.
- **`src/integrations/backend/types.ts`** — v1 ships `export type Database = any`. (v2: regenerate from the user's actual schema.)
- **`src/components/examples/BACKEND.md`** — read-only reference for the AI describing the exposed surface, the same way `LAYOUT.md` documents layout primitives. Tells the AI exactly which imports to use and forbids `createClient` and direct `@supabase/supabase-js` imports.

### 5. Wire-up: `src/server/scaffold-kit.ts`

Extend the public function:
```ts
export function applyScaffoldKit(
  aiFiles: ProjectFile[],
  opts?: { backend?: { url: string; anonKey: string } }
): ProjectFile[]
```

When `opts.backend` is present, merge in `backendKit(opts.backend)` after the static UI kit, all `overwrite: true`. Also add `@supabase/supabase-js` to `REQUIRED_DEPS` so generated `package.json` always has it when a backend is attached.

### 6. Wire-up: `src/routes/api/generate.ts`

1. After auth, look up the project's backend via `getBackendStatus(projectId)` (server-side direct DB call, not the server fn).
2. If `status='ready'`, pass `{ url, anonKey }` to `applyScaffoldKit(...)` for both initial generation and patches.
3. Extend `isProtectedPath` to also cover `src/integrations/backend/`. AI cannot delete or overwrite the injected client/auth/storage files.

### 7. Prompt updates: `src/server/generate.server.ts`

Append a conditional "Backend" section to both `SYSTEM_PROMPT_INITIAL` and `SYSTEM_PROMPT_PATCH`, only when a backend is attached:

> ### Backend (auth + database + storage) is connected
> The user's project has a backend. Use the pre-configured client:
> - `import { supabase } from "@/integrations/backend/client"`
> - `import { useAuth, AuthProvider } from "@/integrations/backend/auth"`
> - `import { uploadFile, getPublicUrl } from "@/integrations/backend/storage"`
>
> Hard rules:
> - NEVER write `createClient(...)` yourself.
> - NEVER hard-code Supabase URLs or keys.
> - NEVER import from `@supabase/supabase-js` directly.
> - NEVER overwrite anything under `src/integrations/backend/`.
>
> If you need a new table, emit a fenced ```sql block at the end of your summary prefixed `MIGRATION:` — do NOT try to run it. The user runs migrations manually in v1.
>
> See `src/components/examples/BACKEND.md` for the full reference.

### 8. UI: `src/components/ProjectSettingsSheet.tsx`

Add a "Backend" section above "Project Knowledge" with three states:

- **Disconnected**: short explainer + **Connect a backend** button → opens an inline form (URL, anon key, optional service role key) with a "Where do I find these?" link to Supabase docs. Submit calls `connectByoBackend(...)`.
- **Connecting**: spinner during the health check (~1–2s).
- **Connected**: green check + "Auth, database, and file storage are connected to `xxx.supabase.co`." Plus a small **Disconnect** button (with confirmation).

No mention of "Supabase" in copy beyond what's necessary for the user to enter their own credentials. Per Lovable Cloud terminology rules elsewhere, we say "backend" / "database" in marketing copy and only surface "Supabase" inside the connect form.

### 9. Helper: `src/lib/projects.ts`

Add `getProjectBackend(projectId)` and `disconnectProjectBackend(projectId)` thin wrappers around the new server functions for the settings sheet to call.

---

## What's intentionally NOT in v1

- ❌ **Managed provisioning.** That's v2 — same `project_backends` table, new `provider='managed_supabase'`, new `provisionManagedBackend` server fn that calls the Supabase Management API. Generated apps don't change.
- ❌ **Supabase OAuth flow** ("Connect with Supabase" button). v1.5 polish; the paste form unblocks shipping.
- ❌ **AI-driven schema migrations.** AI emits `MIGRATION: ...sql...` comments; user copy-pastes into Supabase SQL editor. v2 adds a "Run pending migrations" button using the stored service_role_key.
- ❌ **Typed `Database` regeneration.** v1 ships `Database = any`. v2 regenerates after migrations.
- ❌ **Storage bucket auto-creation.** v1 docs tell users to create an `uploads` bucket manually. v2 automates it via the Management API (managed mode) or service_role_key (BYO).
- ❌ **Edge functions.** Generated apps are static (Cloudflare Pages); server logic is a separate "Add server functions" feature later.

---

## Files touched

**New:**
- `supabase/migrations/<timestamp>_project_backends.sql` — table + RLS above
- `src/server/backend-connector.server.ts` — 3 server functions
- `src/server/backend-kit.ts` — injected `client.ts` / `auth.tsx` / `storage.ts` / `types.ts` / `BACKEND.md` blobs

**Modified:**
- `src/server/scaffold-kit.ts` — extend `applyScaffoldKit` signature with `opts.backend`; add `@supabase/supabase-js` to `REQUIRED_DEPS` (added only when backend present, via a small conditional in `mergePackageJson` or by passing the dep set into `applyScaffoldKit`)
- `src/routes/api/generate.ts` — look up backend, pass to `applyScaffoldKit`, extend `isProtectedPath` to cover `src/integrations/backend/`
- `src/server/generate.server.ts` — append conditional "Backend" section to both prompts
- `src/components/ProjectSettingsSheet.tsx` — new "Backend" section with connect form + status
- `src/lib/projects.ts` — `getProjectBackend` / `disconnectProjectBackend` helpers

**No new secrets in v1.** (Managed mode in v2 will need `SUPABASE_MANAGEMENT_TOKEN`.)

---

## Risk callouts

- **Service role key in our DB.** Even with strict server-side stripping, storing user-provided service_role_keys is a meaningful liability. v1 mitigation: make it **optional** in the connect form and document clearly that it's only needed for future migration features. Many BYO users will skip it entirely in v1.
- **No isolation between Petal and the user's Supabase data.** That's the point of BYO — but be explicit in the UI: "This connects your existing Supabase project. Anything the AI writes will affect data in that project."
- **AI may try to bypass the abstraction.** Protected-path enforcement + prompt rules cover most cases; the patch-validator silently drops protected ops, so the worst case is "AI's edit had no effect" rather than a broken client.
- **Future managed-mode swap requires the abstraction to be airtight.** If even one early generated app imports `@supabase/supabase-js` directly, that app won't benefit from the swap. The protected-path + system-prompt enforcement here is what makes v2 cheap; if we cut that corner, v2 gets expensive.

---

## Suggested implementation order (when you approve)

1. Migration for `project_backends` (1 step, fast).
2. `backend-connector.server.ts` with the 3 server fns.
3. `backend-kit.ts` + extend `applyScaffoldKit`.
4. Protected-path + prompt updates in `generate.ts` and `generate.server.ts`.
5. Settings sheet UI.
6. End-to-end test: create a throwaway Supabase project, paste credentials into Petal, ask the AI to "build a todo list with login", confirm it imports from `@/integrations/backend/*` and the resulting app actually works.
