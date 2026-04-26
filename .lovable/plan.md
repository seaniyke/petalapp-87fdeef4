# Petal — Audit & Hardening Plan

A focused pass to fix real bugs and rough edges we shipped during Phases 1–6, before moving on to Phase 7 (WebContainers / AI backends).

Grouped by **severity**. Each item lists what's wrong, how I'll fix it, and the files involved.

---

## P0 — Correctness & Data Integrity

### 1. `saveProjectFiles` is destructive and non-atomic
**Problem:** `src/lib/projects.ts` deletes all rows for a project, then re-inserts. If the insert fails (network drop, RLS, payload size), the project is left **empty** with no recovery.

**Fix:**
- Replace delete-then-insert with an **upsert-by-(project_id, path)** strategy:
  - Add a unique constraint on `(project_id, path)` via migration.
  - Compute the diff client-side: upsert changed/new files, delete only paths that no longer exist.
- Wrap the delete-of-removed-paths and the upsert in a single Postgres function (`replace_project_files(project_id, files jsonb)`) called via RPC, so it's atomic.

**Files:** `src/lib/projects.ts`, new migration.

---

### 2. No abort handling on in-flight generations
**Problem:** `streamGenerate` accepts a `signal`, but `builder.tsx` never passes one. If a user sends a second prompt while the first stream is running, both write to state and to the DB — last-write-wins races corrupt files and message history.

**Fix:**
- Hold an `AbortController` ref in `Builder`. On new send / unmount / project switch, abort the previous controller before starting a new request.
- Disable the send button while `busy` (already partially done) and surface a "Stop" button that calls `controller.abort()`.
- In the SSE reader, swallow `AbortError` cleanly without setting an error state.

**Files:** `src/routes/builder.tsx`, `src/lib/stream.ts`.

---

### 3. Public iframe sandbox is too permissive (and inconsistent)
**Problem:** `src/routes/p.$slug.tsx` uses `sandbox="allow-scripts allow-forms allow-modals"` — fine, but the **builder preview** iframe has no sandbox at all (will verify), so untrusted model output can hit `localStorage`, IndexedDB, and the parent origin in dev.

**Fix:**
- Apply the same `sandbox="allow-scripts allow-forms allow-modals"` (no `allow-same-origin`) to the builder iframe as well.
- Verify by inspecting `builder.tsx` lines around the iframe render and aligning attributes.

**Files:** `src/routes/builder.tsx`.

---

## P1 — Performance

### 4. Builder bundle is ~2.2MB
**Problem:** `CodeMirror`, `cmdk`, `react-markdown`, and `rehype-highlight` are all in the initial chunk for `/builder`, even though most users hit Preview first.

**Fix:**
- `React.lazy` + `<Suspense>` for:
  - `CodeEditor` (only mounts when `view === "code"`)
  - `CommandPalette` (only mounts when `paletteOpen` is true the first time)
  - `MarkdownMessage` (lazy with a plain-text fallback so first paint is instant)
- Lazy-import `jszip` inside `downloadProject` instead of top-level.
- Confirm the Vite manual chunk split puts `highlight.js` languages in its own chunk (drop unused languages via `rehype-highlight`'s `languages` option — keep only html, css, js, ts, json, bash, md).

**Files:** `src/routes/builder.tsx`, `src/components/MarkdownMessage.tsx`.

---

### 5. Gallery thumbnails mount N live iframes
**Problem:** `/gallery` renders a real `srcDoc` iframe per card. With 60 cards that's 60 parallel JS contexts running model-generated code — heavy on CPU, fans spin on mobile.

**Fix:**
- Use `IntersectionObserver` to lazy-mount each thumbnail iframe only when scrolled into view, and unmount when scrolled out (keep a static placeholder div with the project title gradient).
- Add `loading="lazy"` and `sandbox="allow-scripts"` (no forms/modals needed for thumbnails).
- Cap concurrent live thumbnails to ~6 via a small queue.

**Files:** `src/routes/gallery.tsx`.

---

## P2 — Security & Admin

### 6. No way to bootstrap the first admin
**Problem:** `user_roles` defaults every new signup to `'user'`. The "Featured" toggle and admin RLS policies exist but are unreachable — there's no admin in the table.

**Fix:**
- Add a one-time SQL migration that promotes a specific email (I'll ask which one) to `admin` by inserting into `user_roles` after looking up the `auth.users.id` via `auth.email`.
- Document the manual SQL pattern for future admins in a comment in the migration.

**Files:** new migration, requires user input (which email).

---

### 7. RLS audit on `project_files` for public projects
**Status:** Looks correct — `Anyone can view files of public projects` is gated on `projects.is_public = true`. Same pattern on `project_versions`. **No change needed**, but I'll re-run `supabase--linter` after other migrations to confirm no regressions.

---

## P3 — UX Polish

### 8. Header overflows on mobile (current viewport is 430px)
**Problem:** Builder top bar has 6+ controls (Back, title, view toggle, History, Share, Export, ⌘K, Sign-out). At 430px CSS pixels it wraps or clips.

**Fix:**
- Collapse Export / History / Share / ⌘K into a single "More" `DropdownMenu` below `md` breakpoint.
- Truncate the project title with `truncate min-w-0` and a tooltip on hover.

**Files:** `src/routes/builder.tsx`.

---

### 9. `maybeAutoTitleProject` has no length cap on summary
**Problem:** `summary` from the model can be arbitrarily long. We persist it raw and render it in cards, footers, and `<meta name="description">` — bad for SEO (Google truncates ~160 chars) and visual layout.

**Fix:**
- Trim summary to ~200 chars before persisting (truncate on word boundary, append `…`).
- Same cap on title (already 60, leave it).

**Files:** `src/lib/projects.ts`.

---

### 10. Generation errors don't include the failed prompt context
**Problem:** Inline error bubble + Retry exists, but if the user navigates away and back, `lastUserPrompt` is lost (it's component state, not persisted). The Retry button silently does nothing.

**Fix:**
- Persist failed-prompt as a `messages` row with `role="user"` immediately before calling `streamGenerate` (we already do this — verify), and read the last user message as the retry source instead of relying on ref state.
- Disable Retry if no user message exists.

**Files:** `src/routes/builder.tsx`.

---

## Out of Scope (deferred)

- **Phase 7** (WebContainers, AI-scaffolded backends, image generation) — separate plan once this audit lands.
- Real screenshot service for gallery thumbnails (currently live iframes work; replace later with a worker-rendered PNG cache).
- E2E test suite — we have no test harness today; adding one is its own project.

---

## Suggested Order

1. **P0 batch** (atomic file save + abort controller + iframe sandbox) — one PR, biggest correctness wins.
2. **Admin bootstrap** (P2 #6) — small, unblocks Featured.
3. **P1 perf batch** (lazy chunks + gallery virtualization) — measurable bundle drop.
4. **P3 polish** — mobile header, summary cap, retry hardening.

Before I start, I'll need:
- The **email address** to promote to admin (item #6).
- Confirmation that the **delete-then-upsert atomicity fix** (item #1) is OK to ship as a Postgres RPC (vs. keeping it client-side with a transaction-like pattern). RPC is more correct; I recommend it.
