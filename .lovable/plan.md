# Petal Launch-Blocker Plan (Revised)

Goal: ship a public-launch-ready Petal in ~2 focused days. Four fixes, scoped tight, no infrastructure we'll throw away.

## What we're shipping

1. **Mobile preview fallback** — when WebContainers can't run (iOS, old Android, no SharedArrayBuffer), show the project's last published deployment instead of a dead-end message.
2. **Element picker stabilization** — fix silent failures and make the pick → patch loop reliable.
3. **Soft cost guardrails** — auth checks + per-request hard ceilings on `/api/generate` and `/api/generate-image`. No backend rate-limit infrastructure (platform doesn't have primitives for it yet — revisit when it does).
4. **First-run onboarding polish** — curated starter prompts on the empty Builder state + a one-time 3-step tour.

Out of scope: managed Supabase auto-provisioning, GitHub sync, RAG, voice, full sliding-window rate limiting.

---

## 1. Mobile preview fallback

### Problem
On iPhone/iPad (most consumer traffic), `WebContainerPreview.tsx` returns "Live preview isn't supported on iOS" — a dead end, even when the project has a live deployment.

### Fix
- Add a `publishedUrl?: string | null` prop to `WebContainerPreview`. Resolved server-side in `builder.tsx` loader.
- Resolution priority:
  1. `projects.primary_domain_id` → `project_domains.hostname` (only if `status = 'active'`)
  2. Petal-hosted URL `https://project--{projectId}.lovable.app` if a successful `project_builds` row exists (`status = 'ready'`)
  3. Otherwise null
- When `detectUnsupportedBrowser()` returns a message AND `publishedUrl` exists: render the URL in an iframe with a small banner: "Showing your last published version — open on desktop to edit live."
- When `detectUnsupportedBrowser()` returns a message AND no `publishedUrl`: keep the current message + add a "Publish your project" CTA.

### Files
- `src/components/WebContainerPreview.tsx` (new fallback render branch + new prop)
- `src/routes/builder.tsx` (resolve published URL in loader, pass as prop)
- New `src/lib/published-url.ts` (helper to resolve the URL from project + domains + builds)

---

## 2. Element picker stabilization

### Problem
The picker (`ensurePickerInstalled` + postMessage `onPick`) silently fails:
- Picker script isn't re-injected after SPA route changes inside the iframe.
- `postMessage` events drop if the iframe reloads mid-pick.
- No visible error when injection fails — user clicks "Pick" and nothing happens.

### Fix
- In `src/lib/webcontainer.ts`: make `ensurePickerInstalled` idempotent and safe to call repeatedly. Tag the injected script with `data-petal-picker-version="<const>"` so we can detect/replace stale versions.
- In `src/components/WebContainerPreview.tsx`:
  - Re-inject on every `iframe.onLoad` event, not just initial mount.
  - When `pickActive` is true but no message arrives within 30s, surface a toast: "Picker didn't attach — try reloading the preview."
  - Add a visible armed-state ring on the iframe while `pickActive` is true.

### Files
- `src/lib/webcontainer.ts` (idempotent re-inject, version tag)
- `src/components/WebContainerPreview.tsx` (onLoad re-inject, timeout toast, armed-state UI)

---

## 3. Soft cost guardrails (no backend rate limiting)

### Problem
`/api/generate` and `/api/generate-image` could be abused to rack up Lovable AI / image gen costs. The platform doesn't have backend rate-limiting primitives yet, so building ad-hoc infrastructure now is wasted work.

### Fix — three lightweight protections
1. **Verify auth on both endpoints**: confirm both routes use `requireSupabaseAuth` (or equivalent) and reject unauthenticated requests with 401. This alone removes the bulk of the abuse surface.
2. **Per-request hard ceilings** (server-side, can't be bypassed by client):
   - `/api/generate`: cap input prompt at 8000 chars, cap max output tokens at a fixed value, reject malformed payloads via Zod.
   - `/api/generate-image`: cap prompt at 2000 chars, only allow approved size/quality combos.
3. **Credit gating already exists** (`spend_credit` RPC + `user_wallets`) — verify both endpoints call it BEFORE invoking the AI provider, not after. A user who runs out of credits gets a clean 402-style response and can't keep generating.

### Out of scope (deferred)
- Sliding-window per-user request limits (waiting on platform primitives).
- New `rate_limits` table.

### Files
- `src/routes/api/generate.ts` (verify auth middleware, add Zod input caps, confirm `spend_credit` is called pre-flight)
- `src/routes/api/generate-image.ts` (same)
- `src/lib/friendly-errors.ts` (handle 402 "out of credits" + 400 "input too large" with friendly chat messages)

---

## 4. First-run onboarding polish

### Problem
New users land on the Builder with an empty input and no idea what to type.

### Fix
- On the empty Builder state (no current project, no draft), render a "Start with an idea" panel above the input with 6 curated prompts. Examples: "A booking page for a barbershop", "A community for indie game devs", "An invoicing tool for freelancers", "A landing page for a SaaS launch", "A personal portfolio for a designer", "A waitlist page for a new product".
- Clicking a prompt fills the input and focuses it (does NOT auto-submit).
- One-time 3-step tour using a `localStorage` flag `petal_tour_v1_seen`:
  1. Input box → "Describe what you want to build."
  2. Preview pane → "See your app run live as you iterate."
  3. Publish button → "One click to ship it to the world."

### Files
- New `src/components/StartIdeasPanel.tsx`
- New `src/components/FirstRunTour.tsx`
- `src/routes/builder.tsx` (mount both: panel when empty state, tour on first visit)

---

## Technical notes

- **Published URL** resolved server-side in the builder loader to avoid a client round-trip; SSR'd into the page.
- **Picker version tag**: bump a constant in `webcontainer.ts` whenever the injected script changes; the re-inject check compares the iframe's `<script data-petal-picker-version>` to the constant.
- **No new tables, no new migrations** — keeps blast radius small.
- **Tour**: pure CSS/React, no external library.
- All four items are independent; can ship in any order.

## Order of work
1. Soft cost guardrails (lowest risk, ship first quietly)
2. Mobile fallback (biggest visible win)
3. Element picker fixes
4. Onboarding polish

Estimated time: ~2 focused days.
