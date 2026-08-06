# The Petal AI Generation Bible

How Petal thinks. Every AI decision in the product originates here. If code and this document disagree, the code is wrong.

Version 1.0 — 2026-08-06.

---

## 0. The pipeline

```text
prompt
  │
  ├─ 1. Understanding      normalize, extract intents, detect ambiguity
  ├─ 2. Target detection   web | mobile | extension | backend  (+ subtype)
  ├─ 3. Planning           ordered, minimal, user-visible plan
  ├─ 4. Architecture       file graph, data model, routes, deps
  ├─ 5. Generation         frontend → backend → glue
  ├─ 6. Validation         syntax → imports → types → build → runtime
  ├─ 7. Repair             deterministic first, AI second, bounded
  ├─ 8. Deployment         only a verified artifact ships
  └─ 9. Iteration          targeted edits, rollback, memory
```

Each stage has a **contract**: what it receives, what it must emit, and what it is forbidden to do. A stage may never do another stage's job.

---

## 1. Prompt understanding

**Emits:** `{ normalizedPrompt, intents[], ambiguities[], constraints[] }`.

Rules:
- Multi-intent prompts (3+ distinct features) are enumerated back to the user; Petal builds intent #1 and asks which is next. Never silently build all of them, never silently build one and pretend it built all.
- Petal asks **at most one** clarifying question per turn, and only when two readings produce materially different products. Default: state the assumption and proceed.
- A question turn is a *pure* turn. It must not also edit files or deploy.
- User-stated constraints (brand, colours, stack, "don't touch X") become hard constraints carried through every downstream stage and into project memory.
- Never infer a request the user didn't make. Never drop one they did.

## 2. Target detection

**Emits:** `{ target, subtype, confidence }` — the single classification every downstream stage reads.

- Targets: `web`, `mobile` (one target, ships to both stores), `extension`, `backend`.
- Web subtypes: `landing`, `marketing-site`, `app`, `fullstack`, `dashboard`, `docs`, `game`.
- Reconciliation is centralized. Keyword signals and surface predictors are merged by one resolver; no stage may re-derive the target from the raw prompt.
- Ambiguity resolves toward the **smaller, shippable** interpretation. "A site for my bakery" is a marketing site, not a fullstack ordering platform.
- Confidence below threshold surfaces as a stated assumption in the plan, never as a silent guess.
- Every classification change is a regression-test case.

## 3. Planning

**Emits:** an ordered plan of 3–8 steps, each a user-legible sentence.

- Plans describe **outcomes**, not files. "Add a booking form that emails you" — never "create `BookingForm.tsx`".
- The plan is the contract. Generation may not exceed it; if generation discovers required extra work, it is added to the plan and shown, not smuggled in.
- Order: runnable skeleton → primary user journey → secondary surfaces → polish. The first artifact must always run.
- Landing page before dashboard when the product needs both and the user hasn't said which.
- Plan Mode surfaces the plan for approval before any write. Non-plan mode still records the plan in the turn.

## 4. Architecture

**Emits:** file graph, route table, data model, dependency list — *before* any file is written.

- Decide the whole graph up front. No discovering a needed file mid-generation.
- Every planned import must resolve to a file in the graph or an installed package. Unresolvable import = architecture error, caught here, not at build.
- Dependencies are chosen from a vetted allowlist; anything outside it requires an explicit justification recorded on the turn.
- Data model precedes any component that reads it.
- Shared primitives (brand mark, layout shell, tokens) are declared once and referenced, never duplicated per page.

## 5. Generation

- Generate **complete files only**. A file is emitted whole or not at all. No `// rest of the code`, no ellipsis, no TODO placeholders, no lorem ipsum.
- Frontend before backend before glue, so the first preview is visual.
- Every project gets a real brand name and a real logo mark — invented if the user gave none.
- Never a "demo only" / "simulated" banner, in any domain.
- Never a light/dark toggle unless asked.
- A complete landing page = nav · hero · social proof · features · how-it-works · showcase/stats · testimonials · pricing · FAQ · final CTA · footer.
- Frontend output must satisfy the Frontend Quality Bible; backend output must satisfy the Backend Quality Bible. Those documents are inputs to the generation prompt, not afterthoughts.
- One file at a time where files are interdependent; parallel where they are leaves.

## 6. Validation

Runs in this order, cheapest first, and **fails closed**:

| Gate | Checks | On failure |
|---|---|---|
| 1. Syntax | parse every emitted file | deterministic repair |
| 2. Imports | every specifier resolves; no orphan modules; no Node builtins in browser code | deterministic repair |
| 3. Types | `tsc --noEmit` diagnostics | deterministic, then AI repair |
| 4. Build | bundler build to completion | AI repair with the real error text |
| 5. Runtime | headless load of the built app; console errors, blank-screen check, primary CTA reachable | AI repair |

Nothing reaches preview that hasn't cleared gates 1–4. Gate 5 failures may preview but must be disclosed.

## 7. Repair

- **Deterministic before AI, always.** Known error shapes (missing import, wrong router API, bad JSX attribute literal, unescaped brace, stray Node builtin) have codemods. A codemod is tried before a single token is spent.
- Repair is **bounded**: max attempts per gate, max total repair rounds per turn, and a hard cost ceiling. Exceeding any of them ends the turn with an honest error, not another retry.
- Repair never widens scope. It fixes the failure and nothing else.
- Auto-repair is **free to the user** and labelled as such.
- Every repair records: error signature, fix applied, outcome. This is the training set for new codemods.

## 8. Deployment

- Only a validated artifact deploys. One file revision produces exactly one deployment (compare-and-swap on the build pointer).
- Deployment is verified after the fact: the deployed URL must return 200 and render non-empty.
- Failed deploys never overwrite the last known-good preview.

## 9. Chat editing, rollback, memory

**Editing**
- Chat edits are **targeted**: locate the anchor, change the minimum span, preserve everything else. Never regenerate a working file to change a heading.
- An edit that reduces a file's functionality without being asked to is a defect, not a style choice.
- Every edit is diffed and the byte-delta recorded. Suspiciously large deltas on small requests are flagged before commit.

**Rollback**
- Every turn is a restore point. Failed edits roll back automatically; the user is told what was reverted.
- Rollback is one click and never destroys forward history.

**Memory**
- Persist: stated preferences, rejections, brand, domain rules, formulas, constraints. Never persist file paths or implementation trivia.
- Memory is a hard constraint on every later turn. A rejected idea is never re-proposed.

## 10. Context compression

- Include, in priority order: user's current message → active constraints/memory → the file(s) being edited → their direct imports → route/data model summary → everything else as a symbol index.
- Never send whole files that aren't being touched; send their exported surface.
- Long histories compress to: decisions made, constraints established, open threads. Raw transcript is dropped, never the decisions.
- If context still doesn't fit, narrow the task, don't truncate the constraints.

## 11. Model routing

- Route by **job**, not by prestige: classification/intent → fast cheap model; planning/architecture → strong reasoning model; bulk generation → strong coding model; deterministic repair → no model at all; critic pass → independent model from the generator.
- A **model health guard** tracks rolling error rate per model and skips unhealthy ones automatically; every model has a declared fallback.
- Economy mode downgrades tiers, never gates. It may not skip validation or repair.
- No model name is ever surfaced to the user as an excuse.

## 12. Token & cost optimization

- Cheapest stage that can decide, decides. Never call a frontier model to detect a target.
- Cache: dependency resolution, unchanged file contents, plan for unchanged prompts.
- Every turn carries a cost budget. Approaching it degrades gracefully (smaller scope, stated) rather than failing silently.
- The user is charged once per user-initiated turn. Auto-fix, retries, and internal critic passes are Petal's cost, never the user's.
- On an unrecoverable failure the credit is refunded, automatically.

---

## 13. Non-negotiables

1. Never overwrite working code to satisfy an unrelated request.
2. Never emit an incomplete file.
3. Never ship an artifact that hasn't compiled.
4. Never charge twice for one intent.
5. Never retry silently — bounded, visible, and free.
6. Never re-derive the target outside stage 2.
7. Never let a raw model error reach the user.

*Amend deliberately. Every amendment changes what Petal builds.*
