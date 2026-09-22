# Builder efficiency audit + optimisation plan

Audit is based only on Kimble's own source code and its last 30 days of AI telemetry (1,562 AI calls, 59 turns). No Webby/Go source was inspected — the Webby traits in your brief are treated as reference principles only.

## 1. What is already efficient (PRODUCTION VERIFIED)

- **Targeted context, not whole projects.** Edit turns select files through an import/dependent graph (`impact-graph.server.ts`), the open route and clicked element (`view-context.server.ts`), and a conversational focus memory (`edit-focus.server.ts`). Telemetry confirms it: average **7 files sent per build call**, not the whole project.
- **Prompt caching works.** Of 1.13M input tokens on build calls, **1.03M (91%) were served from cache**. Input dominance is therefore far cheaper than the raw token count suggests.
- **Project summaries are maintained** (project-memory / PIC) and injected as a summary rather than full content for non-structural edits.
- **Context budget guard** estimates tokens before sending and truncates or upgrades rather than overflowing.
- **Heavy build execution is already separated**: the web app orchestrates, a separate Node builder service executes installs, builds and Playwright QA. This matches the dedicated-builder principle.
- **Per-call telemetry table exists** with provider, model, tokens, cost, latency, project and user.

## 2. Where it wastes tokens and calls (measured)

| Finding | Evidence |
| --- | --- |
| **65% of AI calls record no token data at all** | recovery (334), preflight (327), design (150), memory (114), triage (82), coach (8) — all `prompt_tokens = null`. Only streamed build calls backfill usage. |
| **70% of build calls are not linked to a turn** | 384 of 547 `generate` rows have `turn_id = null`, so cost-per-turn and cost-per-failed-build cannot be computed accurately. |
| **Every small task now runs on the build-grade model** | After the OpenRouter migration, classifier-grade modules (triage, preflight, memory, error humanising) still name old cheap slugs, which are all coerced to the same DeepSeek build model. The cheap tier was lost. |
| **~5.5 preflight calls and ~5.7 recovery calls per turn** | 327 and 334 calls across 59 turns. Preflight estimation repeats for prompt variants; recovery self-check runs even when the build had no signal of trouble. |
| **No output cap on utility calls** | `UTILITY_MAX_OUTPUT_TOKENS` exists in config but is not applied at these call sites. |
| **Recovery has the worst error rate** | 52 of 334 recovery calls returned 4xx/5xx and retried — unnecessary spend on a non-essential path. |

Turn economics today: **2.8 AI calls/turn, ~39k input, ~5.3k output, ~$0.017/turn** — and that excludes the 65% of calls with no token data, so true cost per turn is understated.

## 3. Kimble/Webby principles: status

- Implemented: separate builder process, async execution, build/event/project/user relationships, OpenRouter gateway, DeepSeek as the model, provider/model tracking, build status events.
- Partial: per-build token telemetry (build calls only), prompt/completion/total tracking (build calls only).
- Not implemented: platform-key vs user-key attribution per build; token telemetry aggregated onto the build record.

## 4. Changes proposed (no architectural rewrite)

**A. Close the telemetry holes (highest value, lowest risk)**
1. Read `usage` from every non-streamed response and record prompt/completion/total tokens and cost for all features, not just streamed builds.
2. Thread `turnId`, `projectId` and `userId` through the classifier/recovery/design call sites so every call is attributable.
3. Add a `key_owner` column (`platform` / `user`) to match the per-build key attribution principle.
4. Add a per-build rollup view so average, median and p90 input/output, calls per build, retries per build, and cost split by successful vs failed build become one query.

**B. Restore a cheap utility tier**
5. Add `DEFAULT_UTILITY_MODEL` to the central model config and route triage, preflight, phase classification, memory, title/site-info and error humanising to it. One place to change, no new provider.
6. Apply `UTILITY_MAX_OUTPUT_TOKENS` (1024) at those call sites and drop retries to zero for non-essential ones.

**C. Remove avoidable calls**
7. Cache preflight estimates server-side by prompt hash + project revision, and skip the model entirely when the existing heuristic is confident. Target: from ~5.5 to ≤1 per turn.
8. Run the recovery self-check only when the build produced a real signal (no files written, failed verification, or an error), instead of on every turn.
9. Make recovery humanising non-retrying and fall back to the existing deterministic message.

**D. Change-aware validation**
10. Tier QA by change class already computed by the edit classifier: copy/style-only → targeted route screenshot; component change → its routes; structural/new pages → full sweep; publish → full QA. Visual QA is never removed, only scoped.

**E. Self-healing stays, gets cheaper**
11. Repair prompts carry only the failing file plus its direct graph neighbours and the error excerpt, with an explicit cap — no full-project resend on error.

## 5. Expected impact

- Token visibility: from 35% of calls measured to 100%.
- Utility-call spend: roughly an order of magnitude cheaper per call on the ~60% of calls that are classification, plus ~4 fewer calls per turn.
- Build time: a few seconds saved per turn from removed preflight/self-check round trips; larger savings on small edits from scoped QA.
- Reliability: unchanged or better — retries are removed only on non-essential paths, and gates stay fail-open.

## 6. Files that would change

`src/server/ai-provider.server.ts`, `src/lib/ai-model-config.ts`, `src/server/preflight-estimate.server.ts`, `src/server/phase-classifier.server.ts`, `src/server/self-recovery.server.ts`, `src/server/edit-classifier.server.ts`, `src/server/project-memory.server.ts`, `src/lib/project-title.functions.ts`, `src/lib/site-info.functions.ts`, `src/server/understanding.server.ts`, `src/server/visual-qa.server.ts`, `src/routes/api/generate.ts` (call-site wiring only), plus one migration adding `key_owner` and the per-build rollup view, and tests under `src/server/__tests__/`.

## 7. Not touched

Mobile generation, self-healing, visual QA, Cloud/Supabase, Cloudflare, Railway, Paystack, custom domains, project memory, billing and credit rules, and the builder/deployment architecture. No prompt-queue approach.

## 8. What I cannot answer yet

Cost per failed build vs successful build, and retries per build, are not computable until change A lands — the rows exist but lack tokens and turn linkage.
