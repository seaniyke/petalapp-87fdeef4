## Goal

Petal currently optimises for speed and sometimes claims "done" before it really is. We want: **deeper builds, honest status, correct charging, healthy Cloud + AI**. Four focused fixes in one pass.

---

## 1. Depth over speed (build quality)

Default model today is `google/gemini-3-flash-preview` with no reasoning effort. Flash is fast but shallow on multi-file edits → low verifier pass rate (66.7%, target 85%).

**Changes**
- In `src/server/ai-provider.server.ts` / `smart-router.server.ts`: promote default for the `generate` feature to `google/gemini-3.1-pro-preview` (or `google/gemini-2.5-pro` as fallback). Keep `flash-preview` only for `discuss` / `triage` / small clarify turns.
- Pass `reasoning: { effort: "medium" }` for `generate` and `effort: "high"` for explicit "fix" / auto-fix turns.
- Raise `MAX_AUTO_FIX_ATTEMPTS` from 2 → 3 in `src/routes/builder.tsx` and gate the 3rd attempt behind verifier-still-failing (not just build-failed) so we don't waste credits on infra blips.
- In the dynamic prompt (`src/server/dynamic-prompts.server.ts`), add a "verify-before-claiming-done" snippet: the model must run through its own checklist (imports resolved, routes wired, RLS present when tables created) before emitting the recap.

**Why this is safe**: pro models cost more per token but produce far fewer follow-up "fix" turns, so net credits/feature usually drop. We ship a tuning lever, not a fixed price hike.

---

## 2. Billing actually matches work done

Today every build charges between `BUILD_FLOOR=1.0` and `BUILD_CAP=6.0` based on tokens, plus a flat 1.0 for any discuss. Two real problems:

- **Failed turns still charge.** If the AI returns no usable files (`no_files_emitted`, `truncated_response`) we still consume the hold credit. That's the wallet-drain users feel.
- **Auto-fix turns charge separately.** A user pays N times for what they perceive as one request.

**Changes (in `src/routes/api/generate.ts` + `credit-pricing.server.ts`)**
- On `PipelineError` of kind `no_files_emitted | truncated_response | upstream_timeout | upstream_unavailable`: **refund the hold in full**. Add a `billing_event` row marked `refunded_failed_turn` for audit.
- Tag auto-fix turns (`is_auto_fix=true` already exists in telemetry) and **discount them 50%** — they're the system's responsibility, not the user's.
- Add a "max charge per user-initiated turn" cap that includes its auto-fixes (e.g. cap the *aggregate* at `BUILD_CAP` × 1.5), so a runaway 3-fix loop can't cost 18 credits.
- Surface the actual charge per turn in the chat ("This turn cost 2.4 credits") behind the existing `PreflightCostChip` style, only when > 1.0.

---

## 3. Cloud + AI health

User reports Cloud / AI "may not be working as it should." We need a real check, not a guess.

**Changes**
- Add an admin route `/admin/health` (or extend `admin.index.tsx`) that runs four probes server-side and shows pass/fail + latency:
  1. Lovable AI gateway: 1-token ping to `google/gemini-3-flash-preview` and `google/gemini-3.1-pro-preview`.
  2. Lovable Cloud (Supabase Management API): `cloud_status` + `auth.users` count for a known project.
  3. Builder service (Railway): `GET /healthz` with the same retry policy `builder.server.ts` uses.
  4. AI Gateway 402/429 rate over last hour (read from `ai_call_log`).
- Wire the existing `friendly-errors.ts` so when any of these is degraded, *all* builder errors get a calmer banner: "Lovable AI is degraded right now — your turn was not charged" instead of "Petal got confused".
- For ordinary users: add a passive yellow strip on the builder header when health < 100% in the last 5 min, so they understand it's not their app.

---

## 4. Honest "Thinking → Working → Done"

Today the labels exist (`Thinking`, `Working`, `Writing`, `Wrapping up`) but two bugs remain:

- The recap text the model writes ("I've added X, Y, Z") streams in **before** files are saved and **before** the build is even queued, so users see "I've done it" while the deploy is still pending.
- `awaitingBuild` clears on *any* build status, including `failed`, so "Done" can flash before the failure card.

**Changes (in `src/routes/builder.tsx` + `MarkdownMessage`)**
- Suppress assistant past-tense recap text from rendering until **all three** are true: `filesSaved`, `triggerBuild` returned a buildId, and the build row's status is `ready`. Until then, replace past-tense verbs in the streamed recap with present-progressive on the client (already half-done in `sanitizeNarrative` — extend it).
- Introduce a single state machine `petalState ∈ {idle, thinking, working, deploying, done, failed}` derived from existing flags, and drive every chip / banner from it. Removes the current scattered booleans.
- Only show the "READY — WHAT'S NEXT?" / `NextStepsCard` when `petalState === "done"` AND the latest build is `ready` AND no `friendlyError` is set. Currently it can race in during `awaitingBuild` flicker.
- Add an explicit "Done" pill with checkmark in the activity card that only appears once the build is `ready`, so users have an unambiguous completion signal.

---

## Out of scope

- Re-architecting the pipeline tiers
- Switching AI providers
- New billing plans / refund flows beyond per-turn refunds

---

## Files I'll touch

- `src/server/ai-provider.server.ts`, `src/server/smart-router.server.ts` — model defaults + reasoning
- `src/server/generate.server.ts`, `src/server/dynamic-prompts.server.ts` — verify-before-done snippet
- `src/routes/api/generate.ts`, `src/server/credit-pricing.server.ts` — refunds + auto-fix discount + aggregate cap
- `src/routes/admin.index.tsx` (+ new `src/server/health-check.server.ts`) — health probes
- `src/lib/friendly-errors.ts` — degraded-service messaging
- `src/routes/builder.tsx`, `src/lib/sanitize-narrative.ts`, `src/components/BuildActivityCard.tsx`, `src/components/NextStepsCard.tsx` — single state machine + honest "done"

## Verification before I hand back

1. Trigger a build with a deliberately broken prompt → confirm wallet is refunded and the chat shows "not charged".
2. Trigger a normal build → confirm chat shows `Thinking → Working → Deploying → Done` in order, recap appears only after `Done`.
3. Open `/admin/health` → all four probes green; force one off and confirm header banner appears.
4. Run a 2-file feature add with the new pro default + reasoning and confirm verifier passes on first try (target: > 85%).
