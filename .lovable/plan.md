# Phase 7.2 — CDN-served preview, the Lovable model

## Goal

Replace the WebContainer-on-the-client approach with **server-built, CDN-served previews** so mobile devices (and every device) see real, interactive React/Vite apps in the preview pane — exactly like Lovable does it.

You picked **per-project Cloudflare Pages deploys**, which is the correct production architecture. But before I plan that directly I want to flag two findings from research that change how we should sequence this:

### Constraints I confirmed

1. **Our Cloudflare Worker can't run `npm install` or `vite build`.** `child_process` is stubbed in the Worker runtime. So the build step has to happen either (a) on Cloudflare Pages' own build infra (triggered via Git integration), (b) on a small external Node service we run, or (c) inside the Worker using **esbuild's WASM bundle** with deps pulled from `esm.sh` (no npm install needed).

2. **Cloudflare Pages free tier: 500 builds/month total, 1 concurrent build, 20-min timeout.** Pro: 5,000/month at $20. Business: 20,000/month at $200. At ~10 generations/day across just 2 active users, the free tier lasts ~25 days. Worth being intentional about which generations actually trigger a deploy.

3. **Pages Direct Upload requires pre-built `dist/`.** The API only accepts already-built static assets. So even with Pages, we still need a builder somewhere upstream.

### Recommended sequencing — two phases

**Phase 7.2a (this PR): In-house esbuild-WASM build on the Worker.** Ship mobile-working previews fast, in-house, no external infra, no per-build quotas. Output goes to Supabase Storage and serves from `/preview/$projectId/*`. This will work for 95% of generated apps (single-bundle React/Vite) and gives us immediate wins.

**Phase 7.2b (next PR, after we validate): Cloudflare Pages Direct Upload.** Once we know the pipeline works end-to-end, swap the storage backend from Supabase Storage to Cloudflare Pages for true CDN delivery, custom subdomains (`project--$slug.petalapp.lovable.app`), and production-grade caching. The build step stays the same.

This gives you the Lovable model in two safe steps instead of one big risky step. **If you'd rather skip Phase 7.2a and go straight to Pages, I can do that** — but it requires a Cloudflare API token, a separate build worker on Railway/Fly, and we'll spend 2–3x more code on infra wiring than on user-visible behavior. Phase 7.2a is the same code path minus the "upload to Pages" final step.

---

## What we'll build (Phase 7.2a, in-house)

### 1. Server-side build pipeline

**New file: `src/server/build.server.ts`** — a server function `buildProjectArtifacts(projectId)` that:

1. Loads the project's `ProjectFile[]` from Supabase.
2. Runs **esbuild's WASM build** (`esbuild-wasm` package) directly inside the Worker — esbuild has an official WASM build that runs in Workers/edge and does not need `npm install`.
3. Resolves npm imports (`react`, `react-dom`, anything in `package.json`) by rewriting them to `https://esm.sh/<pkg>@<version>` URLs *at bundle time*, so the bundle has no remaining bare imports. esbuild's `external` + a small resolver plugin handles this.
4. Inlines `index.html`, the bundled JS, and CSS into a single static `dist/` tree (`index.html`, `assets/main-<hash>.js`, `assets/main-<hash>.css`).
5. Uploads `dist/` to a **Supabase Storage bucket** `project-builds` under the path `<projectId>/<buildId>/...`.
6. Records the build in a new `project_builds` table: `(id, project_id, status, created_at, dist_path, error_message)`.

**Why esbuild-WASM specifically:** It's the only mature bundler that runs inside a Cloudflare Worker. Vite under the hood uses esbuild for prod bundling, so the output is functionally equivalent for the simple apps Petal generates. Tradeoff: no Vite plugins, no PostCSS plugin pipeline — but our generated apps don't use those (no Tailwind config, no shadcn).

### 2. New `/preview/$projectId/$buildId/*` route

**New file: `src/routes/preview.$projectId.$buildId.$.ts`** — TanStack server route that:

- `GET` reads the file from Supabase Storage (`project-builds/<projectId>/<buildId>/<splat>`).
- Sets correct `Content-Type` per extension (`.html`, `.js`, `.css`, images).
- Sets `Cross-Origin-Resource-Policy: same-origin` so it embeds cleanly under our global COEP header.
- Sets `Cache-Control: public, max-age=31536000, immutable` for hashed assets (the buildId in the URL guarantees cache safety).
- Auth: same as `api/preview.$projectId.ts` — public projects open, private ones gated by Bearer/`?t=` token of the owner.

### 3. Trigger builds from the existing generate flow

In `src/server/generate.server.ts` (or wherever `appendMessages` finalizes a generation), after files are saved, **fire-and-forget call** `buildProjectArtifacts(projectId)`. The build runs async, the chat continues. The client gets the new `buildId` via either:

- A new column `latest_build_id` on `projects`, polled by the builder route after generation finishes, or
- A Supabase Realtime subscription on `project_builds` for that project.

I'll use the column + a refetch on generation complete (simpler, no realtime bus).

### 4. Replace `MobilePreviewFallback` and the fallback path

Both **mobile** and **desktop** previews switch to the new `<CdnPreview projectId buildId />` iframe component. WebContainers stay only as an opt-in "Advanced live preview" toggle (or removed entirely in a follow-up). This means:

- **No more `npm install` on the user's device, ever.**
- Same UX on iPhone Safari, desktop Chrome, anywhere.
- First preview after generation = build time (~3–8s for a small Vite project with esbuild-WASM) + tiny iframe load.
- Subsequent edits = same build cycle. With esbuild this is *fast* — orders of magnitude faster than `npm install`.

### 5. Empty/loading/error states

The `<CdnPreview />` component shows:

- **Building…** while `latest_build_id` is null and a build is in-flight (poll `project_builds.status` every 1s).
- **Build failed** with the captured `error_message` and a "Retry build" button (calls `buildProjectArtifacts` again).
- **Iframe** once `status='ready'`.

### 6. Cleanup of old artifacts

A cron-style server function `pruneOldBuilds()` deletes everything but the latest 5 builds per project from Supabase Storage. We don't need to wire it to a scheduler now — manual or post-MVP.

---

## What changes in the database

One migration:

```sql
-- New table: track each build attempt
create table public.project_builds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null check (status in ('pending','building','ready','failed')) default 'pending',
  dist_path text,                    -- e.g. "abc-123/xyz-789"
  error_message text,
  created_at timestamptz not null default now(),
  ready_at timestamptz
);

create index idx_project_builds_project on public.project_builds(project_id, created_at desc);

alter table public.project_builds enable row level security;

-- Owners can read their own builds; public projects' builds readable by anyone
create policy "read own or public builds" on public.project_builds
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.owner_id = auth.uid() or p.is_public = true)
    )
  );

-- Add latest_build_id to projects for cheap lookups
alter table public.projects add column latest_build_id uuid references public.project_builds(id);

-- Storage bucket (created via dashboard or migration): "project-builds", private,
-- with RLS allowing public-project paths + owner paths.
```

The Supabase Storage bucket `project-builds` will be created with policies mirroring the table.

---

## Files touched (Phase 7.2a)

**New:**
- `src/server/build.server.ts` — esbuild-WASM bundler + storage upload
- `src/routes/preview.$projectId.$buildId.$.ts` — CDN-style asset route
- `src/components/CdnPreview.tsx` — iframe component with build status polling
- `supabase/migrations/<ts>_project_builds.sql` — table + RLS + bucket setup

**Updated:**
- `src/server/generate.server.ts` — kick off `buildProjectArtifacts` after each save
- `src/routes/builder.tsx` — swap `WebContainerPreview` and `MobilePreviewFallback` for `CdnPreview` (keep WebContainer as opt-in dev toggle)
- `src/lib/projects.ts` — add `getLatestBuild(projectId)` helper

**Removed (or deprecated):**
- `src/routes/api/preview.$projectId.ts` — superseded by `/preview/$id/$buildId/*`
- `src/components/MobilePreviewFallback.tsx` — replaced by `CdnPreview`

**Dependencies:**
- `esbuild-wasm` (~9MB, but tree-shaken; runs server-side only)

---

## Phase 7.2b (next PR — Cloudflare Pages Direct Upload)

Once 7.2a is shipped and stable, swap the *upload target* from Supabase Storage to Cloudflare Pages:

- Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
- Replace `uploadToSupabaseStorage()` with `uploadToPages(projectName, distDir)` using Pages' Direct Upload API.
- Each Petal project gets one Pages project (`petal-<shortId>`); each generation creates a new deployment under it.
- Preview URL becomes `https://<deploymentHash>.petal-<shortId>.pages.dev` and the iframe loads that directly — no proxy through our Worker.
- Free-tier cost: monitor build count; alert at 400/500 monthly. Likely upgrade to Pro ($20/mo) before opening to broader users.

I'll only start 7.2b after you confirm 7.2a works on your phone.

---

## Risks I see

1. **esbuild-WASM cold-start on the Worker**: ~500ms first invocation, then warm. Acceptable, but I'll measure.
2. **Apps using imports esm.sh can't resolve** (e.g., a package that does dynamic `require()` at runtime) will fail to bundle. Mitigation: catch the error, surface it clearly, and tighten the system prompt to constrain dependencies to ESM-only (which the prompt already does — only `react` + `react-dom` by default).
3. **Supabase Storage egress cost** at scale. For 7.2a it's fine; 7.2b on Pages eliminates it entirely.
4. **WebContainer code becomes dead weight**. I'll keep it behind a toggle in 7.2a and delete it in 7.2b once we're confident.

---

## Verification after build (7.2a)

1. iPhone Safari: generate a kanban app → preview tab shows real interactive app within 5–10s.
2. Desktop Chrome: same flow, no WebContainer warm-up.
3. Edit one component → new build kicks off → iframe refreshes when ready, no manual reload.
4. Build error (deliberately request a broken package) → error state with message and retry button.
5. Public `/p/$slug` and `/gallery` still render via `buildPreviewDoc` (or migrate them too — TBD in 7.2b).

---

## Two questions I need answered before I start coding

1. **Phase 7.2a first, or jump straight to 7.2b (Cloudflare Pages)?** 7.2a ships in 1 PR with no new secrets and no external infra. 7.2b needs a Cloudflare API token, account ID, and accepts the 500-build/month free-tier ceiling (or $20/mo Pro).
2. **What happens to WebContainers?** Keep as an opt-in "Live coding mode" toggle for desktop power users, or delete entirely? My vote: keep behind a toggle for now, delete after 30 days if nobody uses it.
