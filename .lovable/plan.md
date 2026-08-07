# Petal PRD Engine: Understand the Product Before Building It

## Your observation is correct, and it is the root cause

Petal does **not** write an internal PRD today. What looks like one is a regex keyword scrape:

- `app-spec.server.ts` matches words like "customer", "invoice", "approval" and emits candidate CRUD entities.
- It returns an **empty string** when nothing CRUD-shaped is found, so "build a female pregnancy calculator" produces no spec at all.
- It is CRUD-biased by construction: entities, roles, relations. A calculator, a converter, a quiz, a landing page, and a game all fall through it.
- Its output is a prompt suggestion only. It is never persisted, never reconciled with the classifier or archetype, never enforced, and never checked after the build.

So Petal jumps from raw text straight to templates and file generation. Everything downstream is guessing. Confirmed for the exact failing prompt:

```text
category: generic
surfaces: landing
web subtype: app          → dashboard shell instructions
product blueprint: none
app spec: empty
```

Four independent stages disagreeing, no authority to settle them, and no artifact stating what the product is supposed to do. That is why a pregnancy calculator became a dashboard, and why no gate objected.

## The fix: one PRD, authored once, obeyed everywhere

Introduce a real internal PRD as the pipeline's single source of truth. Every later stage reads it. Nothing downstream may contradict it. The build is accepted or rejected against it.

The PRD is not a document for the user to read. It is a machine-checkable contract.

```text
PRD
  product name and identity
  one-sentence purpose
  target user
  primary outcome the user came for
  product type (utility, content site, workflow app, marketplace, social, game, ai tool, storefront)
  primary workflow: entry → input → action → result → next step
  secondary workflows
  domain logic and formulas, stated explicitly
  data model (only if the product needs persistence)
  required surfaces
  explicitly excluded surfaces
  states: empty, loading, error, success, edge cases
  navigation and responsive model
  content and tone requirements
  acceptance criteria, written as testable scenarios
  out of scope
```

Two rules make it trustworthy:

1. **Nothing is optional by omission.** If the PRD does not name a surface, the builder may not invent it. A calculator does not acquire auth, billing, or an admin panel.
2. **Nothing ships unproven.** Every acceptance criterion becomes an executable browser check. No criterion, no completion.

## How the PRD is authored

A hybrid, in this order, so it is fast, cheap, and never blank:

1. **Deterministic pass** — product family, domain signals, obvious surfaces, known formulas from the archetype catalog.
2. **Model pass** — one structured call that fills the PRD schema from the user's actual words, using the deterministic pass as a prior. Strict schema, no free-form prose.
3. **Reconciliation** — the PRD overrides classifier, subtype, archetype, and template whenever they conflict. Contradictions are resolved here, once, instead of leaking into the prompt.
4. **Persistence** — stored with the project, versioned per turn, and shown to the user as a short plain-English summary before or alongside the build.

For "a female pregnancy calculator" the PRD would state: purpose is estimating due date and gestational age; product type utility; primary workflow LMP or conception date in, validated, calculate, show due date, current week, trimester and milestones; formulas Naegele's rule and gestational age arithmetic; surfaces public landing with the calculator above the fold, results, week-by-week timeline, informational content; excluded surfaces auth, dashboard, admin; acceptance includes a worked example with a known input and expected output.

## Edits vs first builds

The PRD is not only a turn-one artifact. On every follow-up turn, Petal diffs the request against the stored PRD:

- Additive request → amend the PRD, then build the amendment.
- Contradiction → surface it in one sentence, apply the user's newer intent, record the change.
- Cosmetic request → no PRD change, no re-architecture, no scope creep.

This is what stops later edits from quietly drifting the product away from what it was meant to be.

## Phases

**Phase 0 — PRD engine.** Schema, deterministic pass, structured model pass, reconciliation, persistence, versioning, and the user-facing summary. This lands before anything else.

**Phase 1 — Product model corrections.** Add calculator/utility and health/wellness families, a pregnancy-calculator archetype, and replace the ambiguous dashboard default with an intent-preserving complete-product fallback. These now feed the PRD rather than competing with it.

**Phase 2 — PRD-driven planning.** Routes, surfaces, components, scaffolds, and backend decisions are derived from the PRD. Templates may satisfy the PRD; they may never override it.

**Phase 3 — PRD-driven generation.** One canonical PRD is injected into the orchestrator, composer, model prompt, and critic. Generation order is domain logic, primary workflow, supporting surfaces, marketing and educational content, then polish. The critic reviews the diff against the PRD, not against generic taste.

**Phase 4 — Acceptance gate.** Before any build is reported complete: every required surface exists, the primary action is operable on desktop and mobile, PRD acceptance scenarios pass in a real browser, domain formulas are verified against worked examples, forbidden surfaces are absent, and no fabricated results stand in for real logic. Failure triggers one bounded, free repair against the exact failed criterion. Visual QA runs only after this passes.

**Phase 5 — Regression corpus.** Golden prompts spanning structurally different products: pregnancy calculator, mortgage calculator, restaurant site with booking, task manager, marketplace, AI chat tool, portfolio, internal admin tool, mobile habit tracker, and a SaaS product needing landing plus authenticated app. Each asserts PRD shape, delivered surfaces, forbidden surfaces, workflow behavior, responsiveness, and a clean console. The pregnancy case fails if it yields a dashboard or a non-functioning calculation.

**Phase 6 — Telemetry.** Record PRD, confidence, required versus delivered workflows, acceptance failures, repairs, first-pass useful-build rate, and user follow-ups signalling wrong architecture. Recurring failures become new archetypes, rules, and tests, not longer prompts.

## Definition of done

- Every build has a persisted, versioned PRD authored before generation.
- The PRD is the single authority; no stage may contradict it.
- The pregnancy prompt yields a correct PRD, a working calculator, and never a generic dashboard.
- Petal cannot report completion unless the PRD's primary workflow passes in a browser.
- Unknown prompts get an intent-preserving PRD rather than a dashboard default.
- Follow-up turns amend the PRD instead of drifting the product.
- Repairs stay bounded and free: one user request, one charge.
- The full golden matrix passes before builder deployment.

## Technical scope

New PRD module plus its schema, reconciliation layer, persistence, and prompt renderer. Rework of app spec, app-shape classification, web subtype inference, project archetypes, system catalog, staged orchestration, App Composer, critic, verification planning, and browser verification. Existing compile, security, accessibility, and visual gates remain; the PRD acceptance gate is added ahead of final success.
