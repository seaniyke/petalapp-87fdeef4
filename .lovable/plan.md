## Goal

Yesterday's digest is dominated by stream timeouts on first-build scaffolds (book tracker, notes app, "DB + login"), not real code-quality regressions. We'll do three things:

1. Investigate what actually timed out (data, not guesses).
2. Raise the streaming timeout budget for first-build / heavy scaffold turns.
3. Stop the digest from labeling timeouts as "verifier failures" so recommendations stop pointing at the wrong fix.

---

## 1. Investigate timeouts (data pull, no code changes)

Pull from the last 72h:

- `pipeline_failures` rows where `signature` matches `/timeout|aborted|no result returned/i` — group by model, surface, and whether `project_id` had any prior turns (proxy for "first build").
- `ai_call_log` rows with `status = 524` or `status = 0` joined to their phase / promptChars — confirms whether timeouts cluster on big initial generations (high promptChars + scaffold phase) vs small follow-ups.
- A spot-check of 3-5 specific timed-out turns end-to-end: phase classifier output, smart-router pick, model, latency at abort, file count emitted before abort.

Outcome: a short written finding ("X of Y timeouts were first-build scaffolds on `gemini-2.5-pro`, abort fired at ~120s with ~N files already streamed") that justifies the budget change in step 2 and rules out other causes (e.g. model genuinely hanging, router mis-picking).

## 2. Raise first-build timeout budget

Current state in `src/server/ai-provider.server.ts`:

```text
DEFAULT_TIMEOUT_MS        = 25_000   // non-streaming
DEFAULT_STREAM_TIMEOUT_MS = 120_000  // streaming
```

Change:

- Add a third tier: `FIRST_BUILD_STREAM_TIMEOUT_MS = 240_000` (4 min). Only used for the first generate turn on a project, or when the phase classifier reports `scaffold` / `initial_build`.
- `effectiveSignal()` accepts an optional `kind: "default" | "stream" | "stream_first_build"` and picks the right ceiling.
- Caller: `src/routes/api/generate.ts` passes the kind to `aiChatCompletions` based on (a) zero prior `messages` for the project, or (b) the existing phase classifier already producing a `scaffold`-like phase. We reuse what's already there — no new classifier pass.
- Worker wall budget: 240s is still inside Cloudflare Worker streaming limits because we forward bytes as they arrive (the existing comment in `ai-provider.server.ts` already calls this out — the worker doesn't burn CPU while waiting).

We are not touching the 25s non-streaming timeout or the 120s default streaming timeout. Only first-build streams get the longer ceiling.

## 3. Fix digest classification

Current state in `src/server/self-learning-digest.server.ts`:

- `computeTotals` lumps every outcome where `local_verifier_pass !== true` into the verifier-pass-rate denominator, including outcomes that never produced files because the upstream timed out.
- `computeRecommendations` then says "verifier pass rate is X% — add a dynamic-prompt snippet for the top failure." On a timeout-heavy day this advice is wrong.

Changes:

- New bucket in `DigestPayload.totals`: `timeoutRate` (share of generate turns where `pipeline_failures.signature` matches the timeout family OR `ai_call_log.status = 524`).
- `verifierPassRate` is computed only over outcomes where the model actually produced output (i.e. `files_written > 0`). Outcomes with zero files are excluded from verifier numerator/denominator and counted under `timeoutRate` instead.
- `computeRecommendations` gets a new branch: if `timeoutRate > 0.20`, the top recommendation becomes "Timeouts are the dominant failure today — investigate model latency / scaffold size before tuning prompts." The existing "add a dynamic-prompt snippet" branch only fires when `timeoutRate < 0.10` AND verifier pass rate is still low.
- Email + `/admin/digest` page show the new metric as a fourth tile next to verifier / build / followup.

Migration: add `timeout_rate numeric` column to `petal_self_learning_digests` (nullable, default null). No backfill — old rows just show `—`.

## Files touched

- `src/server/ai-provider.server.ts` — add third timeout tier, broaden `effectiveSignal` signature.
- `src/routes/api/generate.ts` — pass first-build hint into `aiChatCompletions`.
- `src/server/self-learning-digest.server.ts` — split timeout from verifier, rewrite recommendations branch, expose `timeoutRate`.
- `src/routes/admin.digest.tsx` — render the new tile.
- `src/routes/api/admin/digests.ts` — include `timeout_rate` in list/get projections.
- New migration: add `timeout_rate` column to `petal_self_learning_digests`.

## Out of scope

- Smart-router weight changes (sample is too small — revisit after 2-3 days of cleaner digests).
- Adding new dynamic-prompt snippets (no real recurring code-level signature exists today).
- Touching the cron schedule, Vault secret, or Resend wiring.

## What you'll see after this ships

- Tomorrow's digest separates "we never finished generating" from "we generated wrong code." The verifier-pass-rate number stops being misleading.
- First-build scaffolds for moderately complex apps (DB + auth, multi-page) stop hitting the 120s wall.
- The "What to do tomorrow" section gives advice that matches the actual failure mode.
