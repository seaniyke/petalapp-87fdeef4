# Petal Launch-Blocker Plan — Shipped ✅

All four launch blockers landed. This document is now the as-shipped record.

## 1. Mobile preview fallback ✅

**Approach:** Promoted the existing `MobilePreviewFallback` (deployed-build iframe with realtime + 5s polling against `project_builds`) to cover all WebContainer-incompatible browsers, not just narrow viewports.

- Added `useWebContainerSupported()` in `src/routes/builder.tsx` that lazy-runs `detectUnsupportedBrowser()` from `WebContainerPreview` once on mount.
- Renamed the render gate to `useDeployedFallback = isMobile || !webContainerSupported`. iOS Safari, iPadOS-as-MacIntel, Android non-Chromium, and any browser without `SharedArrayBuffer` now see the live deployed preview instead of the dead-end "not supported" card.
- Layout-only `isMobile` checks (device frame width chooser, mobile tab nav) intentionally kept as-is.

**Note vs original plan:** We did not add a new `published-url.ts` helper. `MobilePreviewFallback` already resolves the deployed URL from `project_builds.dist_path` directly, with the same priority semantics (latest ready build, fall back to last successful one when the newest is pending/failed). No new code path needed.

## 2. Element picker stabilization ✅

- `src/lib/webcontainer.ts`: bumped picker to `PICKER_VERSION = 2`. Script tag carries `data-petal-picker-version="N"`.
- Picker is now self-superseding inside the iframe: detects an older `window.__petalPickerVersion`, calls a stored `__petalPickerCleanup`, then installs itself. Always re-emits `petal:pick:ready` on attach.
- `ensurePickerInstalled` is fully idempotent: rewrites the public asset every call (cheap), strips any older `__petal_picker.js` script tags from `index.html`, and short-circuits when the current version tag is already present.
- `WebContainerPreview.tsx` re-pushes the live `pickActive` state on every iframe `onLoad` so picks survive HMR full-reloads and SPA navigations inside the user's app.
- 30-second watchdog: if the user arms the picker but no `petal:pick:ready` ever arrives, an inline destructive-toned banner appears with a "Picker didn't attach — try reloading" message.

## 3. Soft cost guardrails ✅

- **Auth + credit gating wired on `/api/generate`**: `requireSupabaseAuth` equivalent (`authorize` helper) → `spendCredit({ reason: "ai_message" })` pre-flight → `refundCredit` on any upstream failure.
- **`/api/generate-image` (option B)**: bearer token present → validate, charge `ai_image` credit, refund on failure. No bearer (calls from generated end-user apps) → keep the existing 10/min per-IP soft cap. This preserves end-user app functionality without giving anonymous traffic unlimited spend.
- **`refund_credit` Postgres function**: bucket-aware refund (daily_free / monthly_grant / topup), with an audit-trail entry in `credit_ledger`.
- **Server-side input cap on `/api/generate`**: latest user message capped at 8000 chars (~2000 tokens). Cap runs BEFORE the credit charge so rejected payloads don't cost the user a credit.
- **Server-side input cap on `/api/generate-image`**: prompt capped at 500 chars (existing).
- **Friendly errors**: added a "too long / too large" pattern in `src/lib/friendly-errors.ts`. 402 (out of credits) and 401 (signed out) were already covered.

**Out of scope (deferred per platform constraints):** sliding-window per-user request limits, dedicated `rate_limits` table. Will revisit when the platform ships rate-limiting primitives.

## 4. First-run onboarding polish ✅

- `src/components/StartIdeasPanel.tsx`: 8 hand-written, specific starter prompts in a 2/3/4-column grid under the landing-page composer. Click → fills textarea, focuses, scrolls into view. Mounted on `/` (landing).
- `src/components/FirstRunTour.tsx`: 3-step product tour (Chat → Preview → Publish) gated on `localStorage["petal:first-run-tour:v1"]`. Versioned key so we can re-show the tour to existing users if we materially change the product. Lazy-loaded on `/builder` so the route's initial bundle is unaffected.

**Note vs original plan:** The tour uses centered cards with arrow-text pointers ("← The chat panel", "↑ Live preview") instead of absolutely-positioned tooltips against specific DOM nodes. Same mental model, but resilient to any future builder layout change.

---

## Files changed (final tally)

### New
- `src/components/StartIdeasPanel.tsx`
- `src/components/FirstRunTour.tsx`
- `src/server/credits.server.ts`
- `supabase/migrations/...refund_credit.sql`

### Modified
- `src/routes/builder.tsx` — `useWebContainerSupported`, deployed-fallback gate, FirstRunTour mount
- `src/components/WebContainerPreview.tsx` — onLoad re-push, picker-ready tracking, 30s watchdog, warning banner
- `src/lib/webcontainer.ts` — versioned picker, cleanup hook, idempotent install
- `src/routes/api/generate.ts` — credit pre-flight + refund + 8000-char input cap
- `src/routes/api/generate-image.ts` — option-B auth/credit branch (anonymous keeps IP cap)
- `src/lib/friendly-errors.ts` — "too long" pattern
- `src/routes/index.tsx` — StartIdeasPanel mount

## What's still open (post-launch backlog)

- Rate limiting infrastructure when the platform exposes primitives.
- Telemetry on tour completion / start-idea pick rate to inform copy iteration.
- A/B prompt copy on the StartIdeas cards (currently static, hand-curated).
