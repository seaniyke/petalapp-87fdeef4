
# Petal AI Audit & Reliability Plan

I pulled real telemetry from `ai_call_log` (last 7d) and `project_builds` (last 14d) to ground this — not vibes. Here is what's actually going wrong, and what to fix, in order of impact.

## Findings

### 1. Build success rate is bad: ~55% (21 ready / 17 failed in 7d)
The biggest user-visible quality problem. Two root causes dominate:

**a. Scaffold ships example files that import a missing UI primitive.**
- `src/server/examples-pack.ts` includes `auth-otp-card.tsx` and `onboarding-verify-step.tsx`, both of which import `@/components/ui/input-otp`.
- The scaffold-kit does not ship `src/components/ui/input-otp.tsx`.
- When the AI follows our own "copy-from auth-otp-card" prompt suggestion, the user's `App.tsx` imports the example, Vite traverses it, and the build fails with `Could not load /src/components/ui/input-otp`.
- This single bug accounts for 3 of the 10 vite build failures in the window — likely more under-counted because the AI sometimes uses the OTP block silently.

**b. AI emits `import { createBrowserRouter, RouteObject } from "@/components/ui/router"` even when our re-export surface used to omit it.**
- Scaffold now exports them, so new builds are OK, but 2+ historical failures show the model favours `createBrowserRouter` patterns. Worth tightening the prompt so the simpler `<Router><Routes>` form is the default and `createBrowserRouter` is only suggested when the user asks for nested data routes.

### 2. Deploy timeouts (7 in 14d): the build worker doesn't report back within 10–20 min
Not an AI quality issue per se, but it surfaces as "Petal failed". Needs separate investigation in the deploy worker — out of scope for this AI audit, but worth flagging.

### 3. Phase router is doing nothing useful
- 18 of 30 recent generate calls were tagged `phase=debug`. Of those, basically all routed to `gemini-2.5-pro`. That's correct — but it also means the user is constantly going back to fix things the model just shipped. Debug rate should be <10% of turns; we're at ~60%.
- The smart router has only ~13 generate samples in the whole window — not enough to actually learn. It picks `gemini-2.5-pro` for `implement` turns simply because it has more successes recorded, even though `gemini-3-flash-preview` is supposed to be the cheap default for implement. Net effect: we pay Pro prices for trivial scaffolds and STILL get failures.

### 4. Real model latency is rough
- p50 generate latency on Pro: 12.6s; p95: 20.4s.
- p50 generate latency on Flash-preview: 11s but p95 spikes to 40.7s (one outlier 42s scaffolding turn).
- Recovery / autofix passes add another 1–15s.
- A user typing a small change waits 13–25s on average. v0/Bolt are at 6–10s for comparable turns.

### 5. We have NO outcome telemetry tying an AI call to a build result
- `ai_call_log` records HTTP status + latency. It does NOT record whether the resulting build compiled, whether the next user turn was a "fix this" message, or whether the local-verifier flagged issues.
- The smart router is therefore optimising for "did the gateway return 200" — which is ~100% across the board — not "did the model produce working code". This is why it can't distinguish good from bad models.

### 6. Post-stream autofix isn't tracked
- We don't know how often it fires, what it fixes, or how often it fails to fix. Could be silently saving 30% of turns or adding noise — we have no idea.

## Plan

### Phase A — Stop the bleeding (highest ROI, ~2-3 hour change)

1. **Ship `src/components/ui/input-otp.tsx` in the scaffold-kit.** Either a real OTP input (using `input-otp` npm package, already a shadcn standard) or a thin fallback that re-exports basic `Input` slots. This single fix removes ~30% of build failures.
2. **Either inline the OTP example or remove it from `examples-pack.ts`** until the kit primitive ships. Same for `onboarding-verify-step.tsx`.
3. **Add a build-time scaffold sanity test**: walk every example file, parse imports, and fail CI if any `@/...` import doesn't resolve in the scaffold output. Prevents regression.

### Phase B — Outcome telemetry (the missing feedback loop)

4. **Add `ai_call_outcomes` table** linking an `ai_call_log.id` to:
   - `local_verifier_pass: bool` (run synchronously after the stream completes)
   - `autofix_ran: bool`, `autofix_fixed_count: int`
   - `next_user_turn_was_fix: bool` (filled in lazily when the next message arrives, classified by phase classifier = "debug")
   - `build_status: text` (filled in when the build finishes)
5. **Update smart-router scoring** to use `outcome_success_rate` (built + no debug follow-up) instead of HTTP 200. This is the single change that lets the router actually learn.

### Phase C — Reduce debug-turn rate by hardening the model output

6. **Tighten `SYSTEM_PROMPT_PATCH`** with the top 3 patterns we see fail:
   - Forbid `createBrowserRouter` unless the user explicitly asks for data routers.
   - Require explicit `export default` next to every page component (the React.lazy footgun the local-verifier already catches).
   - Pin a "no new dependency unless added to package.json" check.
7. **Run the local-verifier BEFORE we save files**, not after. Currently we save, then autofix; if autofix fails the user sees broken output. Reject the AI tool call and force a single retry instead.
8. **Promote `gemini-3-flash-preview` for `implement` turns again** but only after Phase B telemetry confirms its outcome rate isn't worse than Pro's. Right now we're masking the problem by always using Pro.

### Phase D — Latency (lower priority, do after A–C land)

9. **Stream files to the client as they're parsed** rather than waiting for the full tool-call to finish. The scaffolding includes this for `plan_delta`/`summary_delta` but not for `file_progress`. v0 perceived-latency win comes from showing the first file <2s in.
10. **Cap autofix to one round and parallelize with the user's chat-bubble render** so the user sees the result while we patch in background.

## Out of scope for this plan (call out, don't fix)

- Deploy timeouts (deploy worker, not AI).
- WebContainer preview hydration warnings (cosmetic; from console logs).

## Order of operations I propose

Do Phase A first (one PR, ships today, instantly removes the most common failure). Then Phase B (a migration + small worker change — unblocks every smarter routing decision after that). Then C and D iteratively, measuring with the new outcome telemetry.

Would you like me to start with Phase A, or do you want me to draft the full migration in Phase B too in the same change?
