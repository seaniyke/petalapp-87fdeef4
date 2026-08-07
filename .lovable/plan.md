# Petal Product Intelligence and Usefulness Engine

## Goal

Make Petal translate a plain-language idea into the right complete product, with a real primary workflow, appropriate supporting surfaces, excellent frontend quality, and proof that it works before Petal says it is complete.

The governing rule is **not** “always add a landing page and dashboard.” It is:

> Build the smallest complete product that fulfills the user’s actual outcome. Add marketing, account, dashboard, history, admin, or backend surfaces only when that product genuinely needs them.

For “build a female pregnancy calculator,” a successful first build means a branded public experience with an immediately usable pregnancy calculator, validated date inputs, accurate gestational age and estimated due date calculations, useful result presentation, relevant timeline/education, responsive navigation, and working interactions. A generic analytics dashboard is a failed build even if it compiles.

## Verified failure chain

The current pipeline interprets the exact pregnancy-calculator prompt as:

```text
category: generic
surfaces: landing
web subtype: app
product blueprint: none
```

That combination is contradictory and loses the product’s central workflow:

- `web-subtype.ts` defaults ambiguous web products to an app shell whose instructions forbid a marketing hero and emphasize sidebar/dashboard structure.
- `app-shape-classifier.ts` has no health/wellness or calculator/tool category, so it cannot infer the right surfaces.
- `system-catalog.server.ts` contains adjacent health trackers and finance calculators, but no pregnancy/due-date calculator; the App Composer consequently returns no blueprint.
- `app-spec.server.ts` extracts data entities but not a first-class workflow or product outcome, so a calculator can produce an empty spec.
- The staged planner only guarantees marketing + product surfaces for selected archetypes; unknown products do not receive a complete-product fallback.
- Existing quality gates check compilation, placeholders, accessibility, interaction defects, and visual defects, but do not prove that the requested primary workflow exists and works.

## Phase 1 — Correct the product model

1. Add first-class product families for **calculator/utility** and **health & wellness**, including pregnancy/due-date intent.
2. Add a pregnancy-calculator archetype to the catalog with:
   - public landing/navigation surface;
   - calculator as the dominant first-screen action;
   - results/timeline surface;
   - optional saved history only when persistence or accounts are requested;
   - health-safe copy that informs without diagnosing.
3. Replace the ambiguous `app` default with an intent-aware **complete product** fallback. Unknown product requests must not silently become sidebar dashboards.
4. Reconcile subtype, shape, archetype, and blueprint into one authoritative `ProductContract` so downstream stages cannot receive contradictory instructions.

## Phase 2 — Plan outcomes and workflows before files

Extend the app spec from entity-only extraction to a structured product contract:

```text
user outcome
primary workflow: input → action → result → next step
required surfaces
optional surfaces and why they are needed
functional rules and formulas
empty/loading/error/success states
responsive navigation model
acceptance scenarios
```

The planner must produce this contract before choosing components or files. Route and scaffold selection will be derived from the contract, not from generic dashboard templates.

For calculators and utilities, require deterministic domain logic in testable functions rather than simulated values or decorative charts.

## Phase 3 — Make generation execute the contract

1. Feed one canonical contract into the staged orchestrator, App Composer, model prompt, critic, and verifier.
2. Generate in dependency order:
   - domain logic and data model;
   - primary workflow;
   - supporting product surfaces;
   - marketing/education surfaces when appropriate;
   - responsive and accessibility polish.
3. Prevent templates from overriding intent: dashboard components may only appear when the contract contains dashboard jobs.
4. Require every first build to have a real brand identity, working navigation, working forms, meaningful states, and no dead controls.
5. Keep scope bounded: a calculator should not acquire authentication, billing, admin, or a database unless the workflow requires them.

## Phase 4 — Add usefulness and workflow acceptance gates

Add a mandatory **Product Acceptance Gate** before deployment success:

- Confirm every required surface from the contract exists.
- Confirm the primary action is visible and operable on desktop and mobile.
- Execute contract-derived browser scenarios, not only generic route checks.
- Assert input validation, action completion, expected result, and next-step behavior.
- Reject dashboard-only output when the contract calls for a public utility or landing + tool.
- Reject decorative or fabricated results when deterministic logic is required.
- Run visual QA only after workflow acceptance; visual polish cannot compensate for a missing product.

If acceptance fails, Petal performs one bounded, free repair against the exact failed contract item. It never charges another user turn, loops indefinitely, or reports completion while a required workflow is missing.

## Phase 5 — Regression corpus and release gate

Add golden prompts that cover structurally different products:

- female pregnancy calculator;
- mortgage calculator;
- restaurant landing page with booking;
- task manager;
- two-sided marketplace;
- AI chat tool;
- portfolio;
- internal admin tool;
- mobile habit tracker;
- SaaS product needing landing + authenticated app.

Each golden case asserts classification, contract, routes, forbidden surfaces, primary workflow behavior, responsive rendering, and no console/runtime errors. The pregnancy case must fail if it produces a generic dashboard or lacks a functioning calculation.

Run the deterministic classifier/contract suite on every change and the full golden build matrix before builder deployment. A production quality defect is not closed without a regression case.

## Phase 6 — Measure real product quality

Record per build:

- detected product family and confidence;
- final Product Contract;
- required versus delivered workflows;
- acceptance failures and repairs;
- first-pass useful-build rate;
- user follow-up prompts that indicate wrong architecture, such as “this is useless,” “where is the calculator,” or “I asked for X.”

Use those failures to expand deterministic archetypes, rules, and tests. Do not solve recurring categories with increasingly long generic prompts.

## Implementation order

1. ProductContract types and reconciliation logic.
2. Calculator + health classifiers and pregnancy archetype.
3. Contract-driven staged planning and prompt assembly.
4. Contract-aware critic and Product Acceptance Gate.
5. Browser scenarios and pregnancy regression test.
6. Golden prompt matrix and release gate.
7. Build telemetry and quality scorecard.

## Definition of done

- The exact pregnancy-calculator prompt produces the correct product contract and never resolves to a generic dashboard shell.
- The generated calculator performs correct date calculations and passes desktop/mobile browser scenarios.
- Petal cannot mark a build complete unless its primary requested workflow passes.
- Unknown product prompts receive an intent-preserving complete-product plan rather than an arbitrary dashboard default.
- Repairs are bounded and free; one user request still causes one charged turn.
- The full golden matrix passes before deployment, with evidence stored per build.

## Technical scope

Primary areas: app-shape classification, web subtype inference, project archetypes, system catalog, app spec, staged orchestration, App Composer, generation-quality gate, critic, verification planning, browser verification, golden prompts, and build telemetry. Existing compile, security, accessibility, and visual gates remain; the usefulness gate is added ahead of final success.