# Economics foundation: correct refunds, honest costs, build-only free credits

Customer price stays $0.13/credit. Nothing here changes pricing; it makes every cost visible and stops successful work being refunded.

## What the audit found (existing systems to reuse, not replace)

- **Credits:** `user_wallets` + `spend_credit` / `refund_credit` / `check_credit_balance` RPCs, buckets `daily_free` → `monthly_grant` → `topup`, every spend recording its `sources` so refunds go back to the exact bucket. Plans already carry `daily_free_credits` and `monthly_free_cap`. The free build grant will be built on this bucket, not a new wallet.
- **Refund on build failure:** `refund_build_charge` is called from four places in `api/public/builds/callback.ts`, one of them on any "failed" callback, even a stale one. This is the root of the Gilded Shingle loss.
- **Readiness:** revision-bound (`projects.revision`, build `project_revision`). Reused as the only authority.
- **AI cost:** `ai_call_log` already stores tokens, cached tokens and OpenRouter's actual cost. Gaps: no `turn_id` on browser-review calls, no session identity, no cache-write/reasoning tokens, no stage classification.
- **Turn economics:** `turn_economics` table and `recordTurnEconomics` exist, but the one call site in `/api/generate` doesn't fire on the normal success path, so the table is empty.
- **Rates:** `economics_config` (defaults in code). Three price figures disagree today ($0.15, $0.05, $0.13); these get fixed to a single retail constant of $0.13 for reporting only.

## Phase A — Successful work is never refunded (ship first)

1. One function, `decideBuildOutcome(current, incoming)`, used by every callback branch: terminal success wins; an old revision can't overwrite a newer one; duplicates do nothing; a failed browser check is recorded as a *verification* failure, not a delivery failure; an infrastructure timeout after deployment counts as delivered.
2. Refunds go through one outcome-aware function: refund only when the build of the **current revision** did not deploy and no later build of that revision did. A stale or late callback can never refund.
3. `refund_build_charge` gets a server-side guard as well: it refuses when that revision already has a deployed build, so the rule holds even if the code path changes.
4. Refunds never delete cost: cost events stay, marked `failed_work` or `refunded_outcome`.
5. Regression tests for all 10 race cases in the brief.

## Phase B — Honest AI measurement and cache fix

6. Every OpenRouter call carries `turn_id`, `project_id`, `revision`, `build_id`, `stage`, `call_class` (required / optional / redundant / retry / recovery / verification / memory), `session_id`, and the generation ID. The builder's browser-review calls receive the turn ID in the build job.
7. Record from the streamed usage payload: prompt, completion, reasoning, cached and cache-write tokens, actual cost. No extra API calls.
8. Cache investigation using the recorded calls: compare the prompt prefixes of cached (Home/Gallery/Contact/About) vs uncached (Rooms/Amenities) calls. The expected causes are page-specific text placed before the shared context and/or no sticky routing. Fix: stable shared prefix first, page-specific text last, and one OpenRouter `session_id` per generation. No model change, no padding, no context removal.
9. Remove the second "understand request" call when the first result is already in hand; keep the others. Telemetry: calls per turn, by stage, redundant/retry/recovery/verification counts.

## Phase C — One cost ledger

10. New table `cost_events` (append-only). Hierarchy: user → project → turn → revision → build → stage → provider → event. Fields: category (AI_INFERENCE, AI_VERIFICATION, AI_REASONING, IMAGE_GENERATION, BUILD_COMPUTE, BROWSER_COMPUTE, DEPLOYMENT, STORAGE, DATABASE, NETWORK, OTHER_VARIABLE, FAILED_WORK), quantity, unit, cost_usd (nullable), basis (ACTUAL / ESTIMATED / ALLOCATED / UNKNOWN). AI rows are written from `ai_call_log`, so the actual cost has a single source.
11. Builds: the builder reports install / compile / browser / deploy durations and its job ID; stored on the build row. Compute cost is ESTIMATED at the configured per-minute rate, clearly labelled; CPU/memory stay UNKNOWN unless Railway supplies them.
12. Images: every picture event writes a row (provider, model, image id, generated vs reused, cost). Reused = $0 + reuse flag; unknown cost stays UNKNOWN.
13. New table `infra_services` for fixed/shared costs (builder, Railway, database, Cloudflare, storage, email, image provider): monthly fixed cost, usage metrics, allocation method, confidence. These are never charged to individual builds.
14. `turn_economics` is written on every generation (success, failure, no-op) with a running record: estimated, reserved, actual AI/image/build/browser/other, total, credit equivalent, then settled.

## Phase D — Free build credits (build-only)

15. Reuse the existing `daily_free` bucket as `BUILD_GRANT`: 50 per monthly grant period, max 10 per UTC day. Every spend reason is marked as build or non-build on the server. `spend_credit` skips the free bucket for any non-build reason. Only `ai_build_charge` and the turn-level generation charge count as build; images, Cloud, app AI, domains, badges, mobile, marketplace and anything future default to non-build.
16. Atomic: the wallet row is locked (already `FOR UPDATE`), and both caps are checked inside the same transaction, so concurrent requests can't exceed 10/day or 50/month.
17. Refund rule: a refunded free credit goes back to the day it was spent. If that day has passed, it restores monthly remaining only, never extra same-day allowance, and never above 50.
18. Counters on the wallet/ledger: granted, used, refunded, expired, daily used, monthly used. Free and paid spend are shown separately in the ledger.

## Phase E — Reporting and the 10-build cohort

19. `economics_cohort` label on `turn_economics`. The next 10 real generations after deploy are auto-tagged `2026-10-10-BUILD-01…10`.
20. Admin-only report (a new tab on the existing admin AI-spend page) answering all 34 questions, with MEASURED / ESTIMATED / ALLOCATED / UNKNOWN in separate columns and 75/80/85% margin tests against $0.0325 / $0.026 / $0.0195 per credit.
21. Free-grant funnel: per free user, credits used, successful/failed builds, direct cost, first paid purchase and time to it, paid revenue afterward, cost per converted user.

## Testing

Unit tests covering items A to AE in the brief (race cases, cost bases, free-credit caps including concurrency via SQL-level tests, cohort report). After that: full suite, typecheck and production build.

## Technical notes

- Migrations are additive only: `cost_events`, `infra_services`, new columns on `ai_call_log`, `project_builds`, `turn_economics`, `user_wallets`, plus replacements for `spend_credit`, `refund_credit` and `refund_build_charge`. No column is dropped. RLS is admin-only, with explicit grants.
- The builder changes (reporting durations, forwarding the turn ID) only take effect once the build service is redeployed. It still reports an old version.
- Not claimed: no real external build will be run as part of this work. The cohort starts with your next real builds.

## Decisions needed

- The free grant applies to **every signed-in user**, paid users included, on top of the credits they buy. Tell me if it should be free-only users.
- The monthly period is the calendar month (UTC), matching the current usage screen.
