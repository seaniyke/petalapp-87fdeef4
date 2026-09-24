# Replace the tangled build engine with one small, clear pipeline

## Why a plan first
The current build engine is one 7,634-line file with several competing retry, recovery and provider-choice systems. Gemini is still referenced in ~40 files. Replacing this is a high-risk change to a live system, so the scope and order below need your sign-off.

## What changes

### 1. One new build pipeline (replaces the orchestration inside the build engine)
```text
REQUEST -> SCOPE -> PLAN -> GENERATE -> VALIDATE -> REPAIR (only if needed)
        -> VERIFY COMPLETENESS -> BUILD -> BROWSER VERIFY -> PUBLISH
```
Each stage is a small file with plain inputs/outputs under `src/server/engine/`:
- `scope.ts`: requested pages, new vs existing project, read vs write scope (reuses `requested-scope.ts`, `screen-target.server.ts`)
- `plan.ts`: output-size estimate -> units that always fit the real output budget (reuses `buildGenerationUnits`/`safeUnitBudget`). The first-build ceiling rises from 10K to the model's real safe budget so a simple build is one call.
- `generate.ts`: one call per unit through the single model gateway
- `validate.ts`: existing syntax/AST/esbuild checks on changed files only
- `repair.ts`: one targeted repair per broken file (reuses `page-repair.server.ts`)
- `completeness.ts`: deterministic check that every requested page exists; generates only the missing pages, once
- `run.ts`: the only place that decides attempts, continuation, recovery, repair and missing-page regeneration, with fixed limits

The route file becomes a thin wrapper: auth, credits reserve/settle, streaming events, persistence, cancellation. The one-call edit path moves over unchanged.

### 2. One provider policy
`src/server/engine/provider-policy.ts` is the only code that picks a provider: order OpenInference -> Azure -> DeepInfra (last resort), minus providers that failed in this build, with the existing watchdog times. Continuation, repair, recovery and design all call it. The scattered `avoidUpstreams`/`stalledUpstream` plumbing and duplicate routing are removed.

### 3. One bounded recovery table
| Failure | Action | Limit |
|---|---|---|
| Provider stalled/empty/error | same request, next allowed provider | 1 |
| Output cut off | continue only the missing files | 1 |
| Broken file | repair only that file | 1 per file, max 3 |
| Build failure | repair only files named in the error | 1 |
| Missing requested page | generate only that page | 1 |
| Browser/visual failure | report truthfully | 0 |
Failures that exhaust the table end with an honest message naming what is incomplete; never "rephrase your prompt".

### 4. Remove Gemini from production paths
Delete Gemini model ids, fallbacks and routes from generation, repair, design, continuation, visual QA, triage, discuss, memory and admin defaults; everything uses the configured DeepSeek models. Regression test: no production model resolution can return a `google/gemini*` id.

### 5. Fix the known blockers inside the new stages
- Design step "Body has already been read": read the reply body once, with one time limit covering the whole read; fail cleanly to the default design.
- Tidy-up call that still thinks: thinking off.
- Completed pages are never rewritten by later units or repairs.

### 6. Delete confirmed-dead code
After the new path is live and tests pass, remove the replaced recovery handlers, retry helpers, `pipeline/tier-*` duplicates, unused agent/critic/inspector loops and Gemini paths, checking each has no remaining callers.

## Kept as-is
Credits/settlement, project memory, scope locking, completed-page protection, prompt caching, scoped cleanup, cancellation, publishing, database tables, the model gateway, verification service, telemetry, frontend/admin.

## Validation
Full tests + typecheck; new tests for provider exclusion, missing-page recovery, broken-file repair, completed-work protection, cancellation, billing settlement, no-Gemini; trace the real execution path in logs; then one identical fresh-project Rise & Crumb (Home/Menu/About/Contact) run through build, publish and browser check. Report before/after line counts, call paths, and remaining blockers. No readiness claim without that run passing.

## Decision needed: pictures
Image generation currently uses Gemini's image model, and DeepSeek cannot make images. Without a new vendor the options are: (a) keep Gemini for pictures only (not code, design, repair or QA), or (b) drop AI pictures and use the existing built-in illustration fallback. The plan assumes (a) unless you say otherwise.

## Technical notes
- Expected size: the route file drops from ~7.6K lines to roughly 1–1.5K; the engine adds ~1.5K across small modules; net removal of several thousand lines including dead helpers.
- Work lands in stages behind the existing route contract (same SSE event shapes), so the builder UI needs no changes.
