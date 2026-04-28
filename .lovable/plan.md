## TL;DR

Petal is **not** as broken as it feels. The published subdomain you sent (`https://lumen.buildwithpetal.com`) is serving correctly (HTTP 200, full HTML, app shell loads). The two most-recent generations in the database both built successfully (`ready` status, 14:39 + 14:42 UTC). What you're seeing as "no preview" is almost certainly the **in-IDE mobile preview** behavior on the 430px viewport — that path uses the deployed CDN iframe, not WebContainer.

That said, the audit did find **real bugs** worth fixing now, plus a few smaller polish items. Plan below.

---

## What I found

### Bug 1 — `looksTruncated` misses unclosed JSX opening tags  *(real, recent, caused the failed build you sent)*

`src/server/local-verifier.ts` flags a file as truncated only when the last non-whitespace char is NOT one of `) } ] ; >`. The `>` exclusion means a file ending in `<Card className="...">\n` (the exact failure you hit) is treated as healthy and skipped.

The JSX balance check still catches it as a separate `jsx` issue, so the autofix model would fire — but the **truncation continuation pass** (Tier 2.6) won't, which is the only pass that can actually finish the file correctly. The autofix model gets asked to "fix obvious build-breakers" on a half-written component, which it can't really do.

**Fix:** strengthen `looksTruncated` so a trailing `>` only counts as healthy when it closes a tag (`/>` or `</…>`). A bare opening `>` should be treated as truncation. Combined with the existing JSX/brace checks this gets the right behavior.

### Bug 2 — Preview misunderstanding (no code change, just clarification)

On a 430px viewport the builder route sets `useDeployedFallback = isMobile || !webContainerSupported`, so it renders `<MobilePreviewFallback>` instead of WebContainer. That component shows the **deployed CDN iframe** of the latest build. If the project has no `latest_build_id` yet, you see the "Your preview will appear here" empty state.

This is working as designed — but for the project you were testing with, the preview will only appear once the external builder posts back its callback. If a build silently fails or the callback never lands, you'll sit on the spinner forever.

**Fix:** add a "build older than 5 min and still pending" timeout state to `MobilePreviewFallback` so users see "build seems stuck — retry?" instead of an infinite spinner. Cheap, fixes a real footgun.

### Bug 3 — `MobilePreviewFallback` polls every 5s forever, even when build is `ready`

Same file. `setInterval(loadLatestBuild, 5_000)` runs unconditionally for the lifetime of the page. Once the build is `ready` we don't need to keep hammering the DB. Small efficiency fix — stop polling once `status === "ready"`.

### Bug 4 — Tier 4 router exploration always picks `MODEL_FAST` for new candidates

In `src/routes/api/generate.ts` we pass `candidates: [MODEL_FAST, MODEL_BEST]` to the smart router. With `min_samples = 20` (default), neither candidate has enough data on a fresh table, so the router goes to `exploration` mode and picks `MODEL_FAST` ~10% of the time and falls back to `phaseDefault` the rest of the time. That's fine — but `chosenBy` is reported as `phase_router` for the no-data case and `smart_router:exploration` only on the rare exploration roll. It's confusing in logs and means we're not actually using the router yet on most turns.

**Fix:** lower the default `min_samples` to 5 so the router starts using observed data sooner. Add a clearer log line distinguishing "router_no_data" from "phase_default".

### Sanity items (no fix needed, but worth noting)

- **`stream-autofixer.ts` rewriting `react-router-dom` → `@/components/ui/router`** is correct. The Petal app itself uses TanStack Start, but the apps it generates ship react-router-dom re-exported through `@/components/ui/router` (verified in `scaffold-kit.ts` line 3231 and `generate.server.ts` line 49). No bug.
- **`dynamic-prompts.server.ts` "router" snippet** telling the model to put pages in `src/pages/` is also correct for generated apps. Not a bug.
- **DB schema** for `ai_call_log` and `ai_router_config` is fully populated with all columns the smart-router writes/reads. Telemetry is recording.
- **`https://lumen.buildwithpetal.com`** returns HTTP 200 with the published Lumina app shell. Subdomain routing is working.

---

## Plan

1. **Fix `looksTruncated` in `src/server/local-verifier.ts`** to require `/>` or `</…>` for a `>` ending to count as healthy. Add 2-3 unit tests in a comment block (no test runner change).
2. **Add a stuck-build state to `src/components/MobilePreviewFallback.tsx`** — if status is `pending` for >5 min, show an actionable error card instead of a spinner.
3. **Stop polling once `status === "ready"`** in `MobilePreviewFallback` (clear the interval inside the apply path).
4. **Lower default `min_samples` to 5** in `src/server/smart-router.server.ts` and improve the `[smart-router]` log line. Update the migration's seeded row default value (separate migration, idempotent).
5. **No changes** to `stream-autofixer.ts`, `dynamic-prompts.server.ts`, or the subdomain worker — they're correct.

## Out of scope

- I'm not touching the WebContainer rendering path; it works on desktop and is intentionally bypassed on mobile.
- I'm not redesigning the post-stream autofix gating; the local-verifier hard-trigger is already wired and correct once Bug 1 is fixed.

Approve and I'll ship 1-4 in one pass.