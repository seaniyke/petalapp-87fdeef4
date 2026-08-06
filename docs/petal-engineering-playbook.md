# The Petal Engineering Playbook

Reliability standards. Not what Petal builds — whether it can be trusted to build it twice.

This is the document that turns a clever AI builder into a dependable product. Everything here is a **gate**: measurable, automatable, and enforced by the pipeline rather than by good intentions.

Version 1.0 — 2026-08-06.

---

## 1. The gate chain

Every generated or edited project passes these in order. Each gate fails closed.

| # | Gate | Rule | On failure |
|---|---|---|---|
| G1 | **Completeness** | No file contains `TODO`, `...rest of`, ellipsis placeholders, lorem ipsum, or an unterminated block. | Regenerate that file |
| G2 | **Syntax** | Every file parses. | Deterministic repair → regenerate |
| G3 | **Imports** | Every specifier resolves to a project file or an installed package. No browser-side Node builtins. No import of a server-only module from client code. | Codemod → install → regenerate |
| G4 | **Graph integrity** | No orphaned component (defined, never imported). No route linked but not created. No circular import. | Wire or remove |
| G5 | **Types** | `tsc --noEmit` clean, or diagnostics fed back for repair. | AI repair, bounded |
| G6 | **Build** | Bundler completes. | AI repair with real error text, bounded |
| G7 | **Runtime** | Headless load: no uncaught error, non-empty render, primary CTA present and clickable. | AI repair, then disclose |
| G8 | **Standards** | Frontend Quality Bible checklist + Backend Quality Bible checklist. | Fix or report |
| G9 | **Security** | §8 of the Backend Quality Bible. | Block deploy |
| G10 | **Deploy verification** | Deployed URL returns 200 and renders non-empty. | Roll back to last good |

**Rule:** a gate may never be skipped for cost, speed, or "it's a small change."

## 2. Generation discipline

- **Whole files only.** Partial emission is a defect, not a shortcut.
- **One file at a time** where files are interdependent; parallel only for leaves.
- **Architecture before writing.** The file graph is decided before the first byte.
- **Additive by default.** Deleting or rewriting an existing file requires an explicit reason recorded on the turn.
- **Byte-diff honesty ledger.** Every turn records files touched, bytes added/removed. A large delta on a small request is flagged before commit.

## 3. Edit safety

- Chat edits are anchored: locate, replace the minimum span, verify the rest is byte-identical.
- Every turn is a restore point. Failed edits roll back automatically and say what was reverted.
- An edit may not reduce existing functionality unless removal was requested.
- Concurrent edits to one project are serialized by a per-project lock. No two builds race the same file tree.
- One file revision produces exactly one deployment (compare-and-swap on the build pointer). Loops are impossible by construction, not by vigilance.

## 4. Determinism

- Same prompt + same project state should produce a structurally equivalent result.
- Known error signatures map to codemods. **Every recurring AI repair becomes a codemod within one week of being seen three times.**
- The codemod library is the reliability moat. It grows monotonically.
- Non-deterministic steps (model output) are always followed by deterministic verification.

## 5. Budgets

| Budget | Limit | Behaviour at limit |
|---|---|---|
| Repair attempts per gate | bounded | Move to the next strategy |
| Total repair rounds per turn | bounded | End turn with an honest error |
| Turn cost ceiling | per-turn cap | Degrade scope, stated — never silent |
| Turn wall-clock | hard timeout | Abort, refund, report |
| Generated bundle size | per-target budget | Warn, then optimize |
| Generated app LCP | ≤ 2.5s mid-tier mobile | Fix before ship |

Budgets are enforced by the pipeline, not by the model's judgement.

## 6. Turn lifecycle

- Every turn has an explicit terminal state: `succeeded · failed · cancelled · stalled-reaped`. There is no "still running forever."
- Stalled turns are reaped on a schedule and their credits settled or refunded.
- Cancellation is honoured within seconds and cleans up the sandbox.
- One user-initiated turn = one charge. Auto-repair and internal passes are never charged.
- Unrecoverable failure refunds automatically and records the reason.

## 7. Observability

Every turn records, in a queryable form:
- prompt hash, detected target and subtype, plan
- models used per stage, tokens, cost
- gates run, gates failed, repairs attempted, codemods applied
- final state, wall-clock, credits settled

Weekly, these answer: which gate fails most, which error signatures deserve a codemod, which models are degrading, where money is going.

**Model health guard:** rolling error rate per model; unhealthy models are skipped automatically and a declared fallback takes over.

## 8. Testing

| Layer | What |
|---|---|
| Unit | Classifiers, codemods, cost math, entitlement logic — pure functions, fast, run on every change |
| Golden prompts | A fixed corpus of prompts per target with asserted target/subtype/plan shape |
| Pipeline integration | End-to-end generate → validate → deploy on a small matrix, run before every builder deploy |
| Regression | Every production defect becomes a test the same day it's fixed |
| Runtime verification | Headless browser check of the generated app as part of G7 |

A fix without a test is not a fix.

## 9. Change management

- The builder service is versioned and deployed deliberately; a redeploy is a visible, auditable action.
- Prompt and codemod changes are treated as code: reviewed, versioned, revertible.
- Roll forward is preferred; roll back must always be possible within minutes.
- No change ships that hasn't passed the pipeline integration run.

## 10. Incident response

1. Contain — disable the failing path (model, codemod, feature flag) before diagnosing.
2. Refund — anyone charged for a broken turn is made whole, automatically where possible.
3. Diagnose — from the turn records, not from re-running by hand.
4. Fix — deterministic where possible.
5. Test — regression case added.
6. Record — error signature, cause, fix, in the reliability log.

Never apologize twice for the same failure. Fix the category, not the instance.

---

## 11. Reliability scorecard

Reviewed weekly. These are the numbers that matter more than any feature.

| Metric | Target |
|---|---|
| First-attempt build success | ≥ 90% |
| Preview reaches interactive | ≥ 98% |
| Turns ending in an unhandled error | ≤ 1% |
| Repairs resolved deterministically | ≥ 60% and rising |
| Double-charged turns | 0 |
| Zombie turns older than 15 min | 0 |
| Deploys serving a broken app | 0 |
| Median turn cost | flat or falling |

*Version 1.0 — 2026-08-06. Reliability is a product feature. It is the product feature.*
