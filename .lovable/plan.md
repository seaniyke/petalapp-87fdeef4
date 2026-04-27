# Petal Launch-Blocker Plan

Goal: close the gap between current state and a public launch in ~2–3 days of focused work. Four fixes, scoped tight.

## What we're shipping

1. **Mobile preview fallback** — when WebContainers can't run (iOS, old Android, no SharedArrayBuffer), show the project's last published deployment in an iframe instead of a dead-end message.
2. **Element picker stabilization** — fix silent failures and make the pick → patch loop reliable.
3. **Rate limiting on generation endpoints** — protect `/api/generate` and `/api/generate-image` from cost runaway and abuse.
4. **First-run onboarding polish** — a one-time tour + curated starter prompts on the empty Builder state.

Out of scope (deliberately): managed Supabase auto-provisioning, GitHub sync, RAG, voice. These are post-launch.

---

## 1. Mobile preview fallback

### Problem
On iPhone/iPad (most consumer traffic), `WebContainerPreview.tsx` returns the "Live preview isn't supported on iOS" message. The user sees nothing — even if their project has a live deployed URL on Cloudflare Pages.

### Fix
- In `WebContainerPreview.tsx`, when `detectUnsupportedBrowser()` returns a message, look up the project's latest successful build / primary domain and render an `<iframe>` of the published URL with a small banner: "Showing your last published version — open on desktop to edit live."
- Add a prop `publishedUrl?: string | null` to `WebContainerPreview`, plumbed from `builder.tsx` which already knows the current project.
- Resolve the URL in this priority order:
  1. `projects.primary_domain_id` → `project_domains.hostname` (custom domain, if `ssl_status = 'active'`)
  2. The Petal-hosted `project--{id}.lovable.app` URL when a successful `project_builds` row exists
  3. If neither, keep the current "open on desktop" message (no regression)
- If the project has never been published, show a CTA: "Publish your project to preview it on mobile."

### Files
- `src/components/WebContainerPreview.tsx` (add fallback render branch + new prop)
- `src/routes/builder.tsx` (query published URL, pass as prop)
- New helper `src/lib/published-url.ts` (resolves the URL from project row + domains + builds)

---

## 2. Element picker stabilization

### Problem
The picker (`ensurePickerInstalled` + postMessage `onPick`) silently fails in several cases:
- Picker script isn't re-injected when the user navigates inside the iframe (SPA route change).
- `postMessage` events get dropped if the iframe reloads mid-pick.
- No visible error when injection fails — user clicks "Pick" and nothing happens.

### Fix
- In `src/lib/webcontainer.ts`, make `ensurePickerInstalled` idempotent and re-run on every `iframe.load` event, not just on initial mount.
- In `WebContainerPreview.tsx`:
  - Move the `ensurePickerInstalled` call into an `iframe.onLoad` handler so it survives in-app navigation.
  - When `pickActive` is true but no message arrives within 30s, surface a toast: "Picker didn't attach — try reloading the preview."
  - Add a visible state ring on the iframe while `pickActive` is true so users know it's armed.
- Add a `data-petal-picker-version` attribute to the injected script so we can detect stale versions and re-inject.

### Files
- `src/lib/webcontainer.ts` (idempotent re-inject, version tag)
- `src/components/WebContainerPreview.tsx` (onLoad re-inject, timeout toast, visible armed state)

---

## 3. Rate limiting on generation endpoints

### Problem
`/api/generate` and `/api/generate-image` have no per-user limits. A leaked session or abusive user could rack up hundreds of dollars in Lovable AI / image gen costs in minutes.

### Fix
- Add a `rate_limits` table keyed by `(user_id, bucket, window_start)` with an integer counter.
- New helper `src/server/rate-limit.server.ts` exposing `enforceRateLimit(userId, bucket, max, windowSeconds)`. Uses a Postgres upsert with `ON CONFLICT DO UPDATE` to atomically increment.
- Wire into both routes:
  - `/api/generate`: 30 generations per user per hour, 200 per day.
  - `/api/generate-image`: 20 images per user per hour, 100 per day.
- On limit hit, return `429` with a friendly JSON body `{ error, retryAfterSeconds }`.
- Surface the `429` in `friendly-errors.ts` so the chat shows: "You've hit your hourly generation limit. Try again in X minutes."

### Files
- New migration: `rate_limits` table + index on `(user_id, bucket, window_start)`
- New `src/server/rate-limit.server.ts`
- `src/routes/api/generate.ts` and `src/routes/api/generate-image.ts` (call `enforceRateLimit` at top of handler)
- `src/lib/friendly-errors.ts` (handle 429)

---

## 4. First-run onboarding polish

### Problem
New users land on the Builder with an empty input and no idea what to type. Lovable/Bolt both have curated prompt cards; we don't.

### Fix
- On the empty Builder state (no current project, no draft), render a "Start with an idea" panel above the input with 6 curated prompts (3 app types × 2 styles). Examples: "A booking page for a barbershop", "A community for indie game devs", "An invoicing tool for freelancers".
- Clicking a prompt fills the input and focuses it (does not auto-submit — user keeps agency).
- Add a one-time tour (3 tooltips) shown on first visit, dismissed via `localStorage` flag `petal_tour_v1_seen`:
  1. Input box → "Describe what you want to build."
  2. Preview pane → "See your app run live as you iterate."
  3. Publish button → "One click to ship it to the world."

### Files
- New `src/components/StartIdeasPanel.tsx`
- New `src/components/FirstRunTour.tsx`
- `src/routes/builder.tsx` (mount both when empty state + first visit)

---

## Technical notes

- **Mobile fallback URL resolution** runs server-side in the builder loader to avoid a client round-trip; SSR'd into the page.
- **Rate limit windows** use truncated hour/day timestamps as `window_start`, so old rows naturally fall out of the active count. A daily cron (later) can prune `window_start < now() - 7 days`.
- **Picker version tag**: bump a constant in `webcontainer.ts` whenever the injected script changes; the re-inject check compares the attribute to the constant.
- **Tour**: pure CSS/React, no external library — keeps bundle small.
- All four items are independent and can ship in any order; no cross-dependencies.

## Order of work
1. Rate limiting (highest risk, lowest UX visibility — ship first quietly)
2. Mobile fallback (biggest user-visible win)
3. Element picker fixes
4. Onboarding polish

Estimated time: 2–3 focused days.
