# Petal Reliability Milestone (Phase 1 + Intent Engine)

Scope: no new user-facing features. Fix the four things that make Petal feel unreliable, then make it infer the product type from the prompt.

I agree with your ordering with one change: **the TypeScript gate should be built before the intent engine**, because 76% of all build failures (85 of 112) are Vite-stage type errors. It is the single biggest source of "Petal didn't finish". Intent inference is next.

---

## 1. Turn lifecycle — stop the 400 zombies

Confirmed live: `turns` = 400 `running`, 10 `succeeded`, 2 `failed`.

The terminal write in `src/routes/api/generate.ts` is already inside a `finally` and already awaited, so the code path is correct. The zombies come from the paths that never reach that `finally`:

- Client disconnect / tab close cancels the SSE `ReadableStream`. The Worker isolate is torn down and `start()`'s `finally` never runs. There is no `cancel()` handler on the stream.
- Worker CPU/wall-clock eviction mid-build.
- `startTurn()` succeeds but the inner pipeline throws before the stream opens.

Fixes:
- Add a `cancel()` handler to the SSE `ReadableStream` that finishes the turn as `aborted`.
- Extract terminal-write into a `finishOnce()` guard so `cancel()` and `finally` can't double-write or race.
- Add a **sweeper**: any turn `running` with `started_at` older than 15 minutes is marked `aborted` with `error_message = 'stale: no terminal write'`. Run it from the existing builds watchdog (`src/routes/api/builds/watchdog.ts`) so no new cron surface is introduced.
- Backfill the existing 400 rows to `aborted` in the same migration so metrics start from a clean baseline.

Exit criteria: `select count(*) from turns where status='running' and started_at < now() - interval '20 minutes'` returns 0.

## 2. Credit settlement — `post_build_charge_failed`

26 occurrences, most recent 2026-08-05. The drain fix landed but the signature still fires.

- Read the actual failing rows from `pipeline_failures` / the settlement path to get the real error text before changing anything (the last fix was made on inference).
- Make settlement idempotent at the **database** level: a unique key on `(turn_id)` in the charge ledger, and settlement written as a single `insert … on conflict do nothing` + balance update RPC, so a retried request can never double-charge or fail-and-lose.
- On genuine insufficient funds, drain to zero and record the shortfall as debt rather than failing the charge outright.

Exit criteria: zero new `post_build_charge_failed` rows over a week of builds.

## 3. Remove the two dead model routes

- `openai/gpt-5` on `generate`: 107 calls, 107 errors, 358ms avg.
- `google/gemini-pro-latest` on `design`: 62 calls, 62 errors, 38ms avg (invalid-model-ID signature).

Both are masked by fallback, so they cost latency and money on every single call and never surfaced as incidents.

- Remove both IDs from the model tables in `src/server/ai-provider.server.ts` and the design/generate route selections.
- Add a **startup model-ID assertion**: any configured model that isn't in the gateway's known-good list fails loudly in admin rather than silently falling back.
- Add a rolling health rule: if a model's error rate over the last 50 calls is 100%, it's automatically skipped and flagged in `admin.ai-providers`.

## 4. TypeScript gate before deploy — highest ROI

Today the only pre-deploy gate is an esbuild **parse** check, which does not typecheck. Result: 85 of 112 build failures are `vite build failed (exit 1)`.

Loop becomes:

```text
generate -> repair-all -> esbuild parse -> TS typecheck -> repair -> TS typecheck -> deploy
```

- Run the typecheck **in the builder service** (`builder/src/verify.ts`), where `node_modules` already exists — a Worker cannot host `tsc`. Reuse the installed dependency tree from the existing build step, so the added cost is one `tsc --noEmit` pass, not a second install.
- Feed diagnostics back into the existing recovery loop (already proven: 501 recovery calls, 1 error) with a bounded 2 repair rounds, then deploy anyway if only non-fatal diagnostics remain — never trade a working preview for a perfect typecheck.
- Persist the diagnostics so `admin.failures` shows what actually broke instead of a truncated log tail.

Exit criteria: `vite build failed` drops below 20% of failures.

## 5. Build Intent Engine v2 — infer the target from the prompt

`generate.ts:1646` reads `x-petal-target` from the header and defaults to `"web"`. There is no prompt-text inference anywhere in `src/`. The target chip rail was removed on the understanding that inference existed; it never did. "Build me a Chrome extension" currently ships a web app.

- New `src/lib/target-inference.ts`: deterministic scored inference over the prompt returning a `BuildTargetId` plus confidence, using the existing `build-targets.ts` vocabulary.
- Precedence: explicit header from a user action wins; otherwise inference; otherwise `web`.
- Fix Defect B in `src/lib/web-subtype.ts:116-118` — `fullstack` short-circuits before `marketing`, so "landing page for a fintech" returns `fullstack` and gets a dashboard-first `/`. Compare scores instead of short-circuiting.
- Fix Defect C — unify `inferWebSubtype` and `classifyAppShape` onto one shared signal table so "Airbnb clone" can't be `fullstack` in one classifier and `generic` in the other.
- Regression suite of ~30 real prompts (Uber, Airbnb clone, Chrome extension, mobile banking app, landing page for X, inventory API, AI chatbot) asserting target + subtype + shape.

## Not in this milestone

Phases 3–6 from your roadmap (Quality Engine, Beautiful Apps, Backend Intelligence, Learning Engine) are the right next milestones, but every one of them is measured through the `turns` table — which is currently 97% unusable. Fixing measurement first is what makes the later phases provable rather than impressionistic.

## Technical notes

- Files touched: `src/routes/api/generate.ts`, `src/server/turn-recorder.server.ts`, `src/routes/api/builds/watchdog.ts`, `src/server/ai-provider.server.ts`, `builder/src/verify.ts`, `builder/src/build.ts`, `src/lib/web-subtype.ts`, `src/lib/app-shape-classifier.ts`, new `src/lib/target-inference.ts`.
- One migration: backfill stale turns, add the settlement idempotency key.
- Items 1–3 ship without a builder redeploy. Item 4 requires **Admin → Builder → Redeploy**.
- Each item lands with a regression test under `src/server/__tests__/`.
- `docs/petal-capability-audit-v1.0.md` gets an "as of" row per item so progress is measured against the baseline.
