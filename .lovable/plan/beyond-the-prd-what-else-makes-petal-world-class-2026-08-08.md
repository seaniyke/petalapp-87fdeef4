# Beyond the PRD: what else makes Petal world-class

The PRD stage fixes *understanding*. Three other gaps decide whether a build is actually good. Evidence from the codebase audit plus how Devin, Replit Agent, Kiro and Claude Code work:

1. **Nothing proves usefulness.** Every blocking gate today is syntax/compile shape (`preemit-gate.server.ts` blocks only on parse, jsx, braces, undefined, missing-sibling/export). Runtime checks exist but are advisory and live-only.
2. **The classifier still overrides intent.** `web-subtype.ts` has no `tool` type and defaults unknown prompts to `app`, whose HARD CONSTRAINT block forbids a landing page. `generation-quality-gate.server.ts` then *penalises* a correct calculator for lacking a sidebar. The PRD can be right and still get overruled downstream.
3. **Quality is not regression-tested.** The golden-apps harness replays only esbuild + local-verifier; `bundlePassed`/`typecheckPassed` are hardcoded stubs, and browser/visual/flow gates never run in CI. Model quality drift is invisible until a user hits it.

## What to build, in order

### A. Make the contract authoritative end to end
Remove the paths that can override the PRD after it is authored.
- Add `tool` to `WebSubtype` with its own addendum (centered canvas, public by default, no forced shell), so utilities stop borrowing the dashboard prompt.
- Gate `APP_ADDENDUM` and the `subtype === "app"` quality rule behind "the PRD requires a dashboard" instead of "the classifier guessed app".
- Delete the direct conflict between "single-page tools do not need a router" and "routes structured as workspace areas" — one wins, chosen by the PRD.

### B. A usefulness gate with teeth
A new `product-acceptance.server.ts`, a peer of the existing verifiers, that takes the PRD acceptance criteria plus the generated route/flow/module inventory and emits defects in the same shape the repair loop already consumes. It must be able to **block**, not advise, for the small set of criteria that are objectively checkable: required surface missing, excluded surface present, stated formula has no implementation module, primary workflow has no completing action.

### C. Close the loop with evidence, not assertion
- Promote browser flow failures from advisory to blocking for the PRD's primary workflow only (keeps false positives bounded).
- Prefer accessibility-tree assertions over screenshots for functional checks; keep vision scoring for layout defects only.
- Report completion with the evidence: which criteria passed, which screenshots, which route probes. No "shipping it" without a proof list.

### D. Regression-test quality, not just compilation
- Wire the real esbuild bundle and typecheck into `golden-apps/grade.ts` (today both are stubs).
- Add `productAcceptancePassed` to `GradeResult` and `isPassing`.
- Expand the corpus with the failure cases we actually shipped: pregnancy calculator, restaurant booking, portfolio, marketplace, SaaS with landing + app.

### E. Size the work to the reliability ceiling
Measured agent reliability collapses on long tasks. Instead of one giant generation, generate in verifiable increments — shell, then primary workflow, then secondary surfaces — each passing its own gate before the next starts. This also makes partial failure recoverable instead of a full rollback.

### F. Trust and cost hygiene (smaller, high leverage)
- One repair budget per turn, already partly present via the repair ledger — surface it to the user so a loop is visible, not silent.
- Never charge for a turn whose output failed a blocking gate and was rolled back.

## Suggested sequencing

| Step | Scope | Why first |
| --- | --- | --- |
| 1 | A — contract authority | Cheapest, and the current top cause of wrong-shaped apps |
| 2 | B — usefulness gate | Turns the PRD from advice into enforcement |
| 3 | D — CI corpus | Locks 1 and 2 in so they cannot regress |
| 4 | C — evidence loop | Needs B's defect shape to exist |
| 5 | E — incremental generation | Largest change; do it once the gates can judge each increment |
| 6 | F — trust/cost | Independent, can slot anywhere |

## Technical notes

- Files touched in step A: `src/lib/web-subtype.ts`, `src/lib/app-shape-classifier.ts`, `src/server/generation-quality-gate.server.ts`, `src/server/generate.server.ts`.
- Step B lands as `src/server/product-acceptance.server.ts`, called from `runPreEmitGate`, emitting `LocalIssue`-shaped defects so the existing repair loop picks them up with no new plumbing.
- Step C touches `src/server/verify-plan.server.ts`, `builder/src/verify.ts`, `src/lib/verification-report.ts`.
- Step D touches `src/server/__tests__/golden-apps/{grade,replay,prompts}.ts`.
- Step E is a change to the staged pipeline (`src/server/pipeline/*`) and would graduate it out of Labs.

Tell me which step to start with, or say "all" and I will run them in the order above.
