# Petal duplication audit

Goal: find every place where multiple independent modules implement the same job (the same pattern that made the question-asking layers fight each other), rank by risk, and propose a safe consolidation order. No code changes in this turn — this is the audit + roadmap. We touch nothing until you pick what to consolidate.

## How the audit was done

Scanned `src/lib`, `src/server`, `src/routes/api`. For each suspect group I read the file headers to confirm overlap vs. legitimate specialization. Flagged a group only when (a) modules answer the same question, (b) they run in the same turn, and (c) divergence between them is the kind of bug that just bit us in triage/discuss/generate.

## Findings, ranked by how badly they mirror the question-asking bug

### 1. CRITICAL — 15 hand-rolled "intent detectors" (`src/lib/*-intent.ts`)

`backend-intent`, `payment-intent`, `email-intent`, `domain-intent`, `seo-intent`, `add-page-intent`, `mobile-intent`, `analytics-intent`, `ai-feature-intent`, `storage-intent`, `realtime-intent`, `cron-intent`, `game-intent`, `high-stakes-intent`, `integration-request-intent`.

Each file is the same shape: a `STRONG_SIGNALS` regex list + a `detectXIntentInTurn(prevUser, reply)` function. `builder.tsx` runs **all 12** of them on every assistant message (lines 3434–3851) to decide which inline suggestion chip to render. Several also re-run `detectBackendIntent` as a sub-check, so the same regex set evaluates 5+ times per turn. New intent type = new file + new import + new render branch — exactly the fragmentation pattern we just fixed.

**Risk if left alone:** every new chip type adds another regex list that can disagree with triage, and chips already silently overlap (storage + backend + realtime fire together on the same message).

### 2. HIGH — 5 overlapping classifiers/routers feeding generation

`src/routes/api/triage.ts`, `src/server/semantic-router.server.ts`, `src/server/smart-router.server.ts`, `src/server/phase-classifier.server.ts`, `src/lib/app-shape-classifier.ts` (plus `two-phase-gate.server.ts`).

Each one inspects the user prompt and tags it with something (mode, archetype, phase, model, app-shape, gate). They have legitimate separate jobs, but the boundaries are blurry — `triage.mode` and `phase-classifier.phase` both influence model choice, `semantic-router` and `app-shape-classifier` both predict app surfaces. If two disagree on the same turn, the later one silently wins. Same failure mode as triage vs. generate.

### 3. HIGH — Verification / autofix pipeline has 8 layers

`local-verifier`, `esbuild-verifier`, `render-risk-linter`, `rls-sanity-linter`, `validate-styles`, `stream-autofixer`, `post-stream-autofix`, `strip-hallucinated-imports`, `tool-call-guard`, `self-recovery`.

Most are legitimately staged tiers (2.0 → 2.9). But `stream-autofixer` (regex) and `post-stream-autofix` (model) overlap, and `strip-hallucinated-imports` partly duplicates what `post-stream-autofix` is asked to do. Worth tightening, not collapsing.

### 4. MEDIUM — `.ts` / `.server.ts` / `.functions.ts` twins

| Module | Files |
|---|---|
| runtime-wallet | `lib/runtime-wallet.ts` + `server/runtime-wallet.server.ts` |
| petal-subdomain | `lib/petal-subdomain.ts` + `server/petal-subdomain.server.ts` |
| petal-email | `server/petal-email.functions.ts` + `server/petal-email.server.ts` |
| preflight-estimate | `.functions.ts` + `.server.ts` |
| managed-migrations | `.functions.ts` + `.server.ts` |

Some of these are correct (functions = createServerFn wrapper, server = pure logic). Others (runtime-wallet, petal-subdomain) look like accidental forks. Needs a per-pair read before touching.

### 5. MEDIUM — `scaffold-kit*` is split across 6 files

`scaffold-kit.ts`, `scaffold-kit-blocks.ts`, `-blocks-2`, `-blocks-3`, `-blocks-4`, `scaffold-kit-mobile.ts`, plus `examples-pack.ts` + `examples-pack-2.ts`. The `-2/-3/-4` numbering is a strong signal these grew by append rather than refactor. Risk is low (data files, no runtime conflict) but maintenance is bad.

### 6. LOW — Discuss/Generate post-consolidation leftovers

`src/server/answer-options.server.ts` still exists but the previous consolidation made it unreachable from discuss/generate. Either re-wire it as triage's chip source or delete it. Same for `SuggestionChecklist.tsx`'s suggestion-parsing branches.

## Recommended order (safest first)

```text
Step A  delete dead code from last consolidation (Finding 6)
Step B  unify the 15 intent detectors behind one registry (Finding 1)
Step C  audit the 5 .ts/.server.ts twins, merge the accidental ones (Finding 4)
Step D  rationalise scaffold-kit-* into one indexed module (Finding 5)
Step E  draw the classifier/router contract on paper, then merge or
        explicitly split jobs (Finding 2)
Step F  tighten stream-autofixer vs post-stream-autofix overlap (Finding 3)
```

A, C, D, F are mechanical and low-risk. B is the highest payoff — it kills the exact "12 independent regex lists fight each other" pattern. E is the highest risk; do it last and only after we agree on the contract.

## What I'd do first (suggested next turn)

**Step B — Intent Registry.** One file `src/lib/intent-registry.ts` exporting:

```ts
type IntentId = "backend" | "payment" | "email" | "domain" | ...
type IntentRule = { id: IntentId; signals: RegExp[]; chip: ChipSpec; requiresBackend?: boolean }
export function detectIntents(prevUser: string, reply: string): IntentId[]
```

All 15 regex lists move into the registry as data. `builder.tsx` replaces 12 detector-import + 12 render branches with one loop over `detectIntents(...)`. Same chip UX, one place to add new intents, zero behavior change on day 1. Then we can delete the 15 files in one follow-up commit.

## Technical notes

- No DB changes, no migrations, no UI changes in any step.
- Steps B, C, D, F are pure refactors and reversible. Step E needs a written contract first.
- Each step ships as its own turn so we can verify the build between them.

## Scope of THIS turn

This plan only. Pick the step(s) you want me to execute (recommend Step A + B first) and I'll implement them in build mode.
