# Petal — Roadmap to Lovable / Bolt / Base44 parity

## What the three reference platforms have in common

After studying Lovable, Bolt.new and Base44, every one of them is built on the same 10 pillars:

1. **Conversational build loop** — describe → generate → iterate via chat
2. **Live sandboxed preview** — iframe or WebContainer
3. **Editable file tree + code view** — drop into source when needed
4. **Auth + persistent projects** — your work follows you across sessions/devices
5. **Version history / checkpoints** — every chat turn is restorable
6. **Sharing & publishing** — public preview URL, one-click deploy
7. **Built-in backend** — auth, DB, storage the model can wire up for you
8. **Community gallery / remix** — discover and fork others' projects
9. **Streaming UX** — tokens, file writes, summary stream in real-time
10. **Diff-aware edits** — partial file patches instead of full rewrites

**Petal today** ✅ has 1, 2, 3, and a working AI integration on Lovable Cloud.
**Petal is missing** 4, 5, 6, 7, 8, 9, 10 — plus polish like Markdown rendering, real ZIP export, and richer project capabilities (React, backends).

This plan sequences those gaps into shippable phases, biggest-leverage first.

---

## Phase 1 — Persistence, Auth & Project Library *(highest value)*

This is the single change that turns a demo into a product. Right now a refresh wipes everything.

**Backend (Lovable Cloud migration):**
- `profiles` table (id, display_name, avatar_url, created_at) — RLS: users see/edit their own
- `app_role` enum + `user_roles` table + `has_role()` security-definer function (per the project's role rules — never store roles on profiles)
- `projects` table: id, owner_id, title, summary, slug (unique), is_public, created_at, updated_at — RLS: owner can CRUD; anyone can SELECT where `is_public = true`
- `project_files` table: id, project_id, path, content, updated_at — RLS via `projects.owner_id`
- `messages` table: id, project_id, role, content, created_at — RLS via `projects.owner_id`
- Trigger: `handle_new_user` inserts a profile row on `auth.users` insert

**Auth:**
- Email + password sign in / sign up using `supabase.auth`, plus Google OAuth (per project rules; default Google on, no auto-confirm by default — user verifies email)
- `/auth` route with sign-in / sign-up tabs, branded with the pastel theme
- `useSession()` hook that reads `auth.onAuthStateChange` and exposes user
- Protect `/builder` — redirect unauthenticated users to `/auth`

**Project library:**
- New `/projects` route — grid of the user's projects (title, last edited, tiny preview thumbnail placeholder, "open" + "delete" + "duplicate")
- Builder loads a project by `?id=…`. Switching project pulls files + message history from DB
- Auto-save on every successful generation (upsert files, append message turn)
- "New project" button → creates an empty project row, then routes to `/builder?id=…`

**UI changes:**
- SiteHeader gets an avatar dropdown when signed in (Projects · Account · Sign out)
- Landing page: when signed in, primary CTA becomes "Open my projects"

---

## Phase 2 — Version history & restore *(safety net users expect)*

- New `project_versions` table: id, project_id, message_id, snapshot (jsonb of files), summary, created_at
- After every successful generation, snapshot the new file set
- Builder side panel: a vertical timeline of versions with the assistant's summary on each
- "Restore" button replays a snapshot into the working files (and writes a new "restored from vN" entry so it's non-destructive)

---

## Phase 3 — Streaming generation + diff-based edits *(faster, cheaper, less regression)*

**Streaming:**
- Switch the AI gateway call to SSE (`stream: true`) and forward chunks via TanStack Start's response streaming
- Chat shows assistant tokens appearing live; "Petal is building…" replaced with a real progress feed
- As file blocks resolve, the file tree shows a "writing…" badge per file

**Diff edits:**
- Add a second tool to the AI: `patch_files` with `{ path, content }[]` for changed files plus `{ path }[]` for deletions
- System prompt routes "first turn" → `write_project`, "subsequent turn" → `patch_files` unless a wholesale rewrite is needed
- Apply patches client-side, then snapshot
- Token + latency win on every iteration after the first

---

## Phase 4 — Sharing, publishing & remix

- Public preview route: `/p/$slug` — read-only iframe of the project (uses the same `buildPreviewDoc`), no chat, no editor, with an "Open in Petal / Remix" button
- Toggle in builder: "Make public" flips `is_public` and reveals the share URL + copy button
- "Remix" duplicates the project under the current user's account and opens it in builder
- Real export: replace the `.txt` dump with a proper `.zip` (use `jszip` — pure JS, Worker-safe) containing all files at their real paths

---

## Phase 5 — Community gallery

- `/gallery` route — grid of all `is_public = true` projects, sorted by recency / remix count
- Add `remix_count` (incremented when someone remixes) and optional `cover_image_url`
- Each card → `/p/$slug` with a Remix CTA
- Featured tag on a small curated set (admin role via `has_role`)

---

## Phase 6 — Chat & editor polish

- Render assistant messages with `react-markdown` + GFM (code blocks, lists, links) — currently rendered as plain text
- Add a lightweight code editor (`@uiw/react-codemirror` with HTML/CSS/JS modes) instead of a `<textarea>` — syntax highlighting, line numbers, tab-to-indent
- Keyboard shortcut palette (⌘K): jump to file, run "regenerate last", toggle preview/code
- Better error states: when the model fails to return valid project JSON, surface the actual model message with a "retry" affordance instead of a generic toast

---

## Phase 7 — Capability expansion (the bigger leap)

This is where Petal stops being a vanilla-HTML toy and starts approaching Bolt/Lovable parity in what users can build. Larger scope; ships last.

- **React / multi-framework projects via WebContainers (StackBlitz SDK)** — runs a real Node + Vite environment in-browser. Replaces the inline `srcDoc` strategy. Significant infra work.
- **Backend wiring** — let the model scaffold its own Lovable Cloud tables/edge functions for the user's app (e.g. "build me a tweet clone with login" actually creates `posts` + RLS). Requires a server-side migration tool exposed to the AI.
- **AI image generation** — when the model wants imagery (logos, hero backgrounds, recipe photos), call `google/gemini-3-flash-image-preview` via the gateway and inline as data URIs or upload to Cloud Storage.

---

## Recommended sequence

I'd ship **Phase 1 first** in a single focused pass — it's the biggest perceived-quality jump and unlocks everything else (history needs a project to attach to; sharing needs a slug; gallery needs `is_public`). Then 2 → 3 → 4 → 5 → 6, then evaluate whether Phase 7 is worth the infra investment based on how users are actually using it.

## What I need from you to start

Confirm the order, and let me know if you want any phase **split, reordered, or cut**. Two specific decisions worth making up front:

- **Auth providers** — default is Email+password + Google. Want to add others (GitHub is popular for a dev-tool audience) or keep it lean?
- **Public projects default** — should new projects start `is_public = false` (private, opt-in to share) or `true` (public, opt-out)? Lovable defaults to public; Base44 defaults to private. I'd recommend **private by default** for trust.

Once you approve, I'll start on **Phase 1: Persistence, Auth & Project Library**.
