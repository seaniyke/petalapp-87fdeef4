# Petal Generation Engine 3.0 — understand the product before writing it

## 1. Current vs proposed architecture

### Current (verified in code)

```text
POST /api/generate
  → fast-triage (build / discuss / clarify)          regex + small model
  → resolveBuildTarget (prompt-inferred, header fallback)
  → PRD engine        ONLY when target === "web"     model on turn 1, regex amend later
  → design direction  design-director + themes + palette presets
  → planning board    agents/orchestrator            ALL agents deterministic, budget 0
  → prompt assembly   PRD + design + decisions + blueprint + architecture + contracts
  → model streams file ops
  → ~40 deterministic healers (imports, styles, palette, layout, router, kit closure)
  → esbuild verify → builder → deploy
  → visual QA (screenshots → vision model → geometry defects only)
  → bounded repair → memory writer + blueprint/architecture persistence
```

Four structural weaknesses, each confirmed by reading the code:

1. **No canonical context.** PRD (`project_prds`), blueprint/architecture (`project_blueprints.blueprint`) and memory (`project_memory` key/value, 30-key cap) are three independent stores with three independent readers. Nothing assembles them.
2. **The planning board doesn't reason.** Every agent in `agents/registry.ts` is `modelProfile: "deterministic"`, `budgetMicroUsd: 0`; the design agent restates PRD fields. Its output is an advisory prompt block — blocking objections are counted, then ignored.
3. **Understanding is lexical past the first turn.** `prd-amend.ts`, `edit-intent.server.ts`, `intent-targets.server.ts`, `edit-scope-guard.server.ts`, `semantic-router.server.ts` are all keyword/token scoring. New phrasing silently misroutes.
4. **Quality is enforced downstream.** Codemods repair styling after generation instead of a committed spec constraining it, and visual QA deliberately discards craft findings as subjective — the exact defects behind "apps look plain".

Also: the PRD only runs for `buildTarget.id === "web"`, so mobile, extension and backend builds get no product contract at all.

### Proposed

```text
prompt
  → SEMANTIC UNDERSTANDING (one model call, cached per turn)
      product type · platforms · surfaces (marketing / app / both) · backend needs
      · auth · payments · realtime · storage · roles · confidence per decision
  → PIC LOAD (canonical, versioned per project)
  → escalation router: micro / normal / structural / initial / complex
  → PLANNING BOARD (model-backed where judgement matters, deterministic elsewhere)
      conflicts resolved BEFORE generation; blocking objections gate the turn
  → PIC COMMIT (PRD + design system contract + architecture + decisions + protected)
  → IMPACT SCOPE (affected / dependencies / protected)
  → BUILD in dependency order → heal → verify → deploy
  → QA: functional defects (existing) + craft defects (new, bounded loop)
  → PRODUCT ACCEPTANCE gate → PIC update
```

PIC is the single assembled truth. The existing PRD, blueprint and memory stores stay and become writers/projections into it — nothing is deleted.

## 2. Files and modules that change

Changed:
- `src/routes/api/generate.ts` — insert understanding + PIC load/commit; run the PRD for every target, not just web; feed PIC into prompt assembly.
- `src/server/agents/registry.ts`, `selection.ts`, `runtime.ts`, `orchestrator.server.ts` — model escalation per agent, conflict resolution, binding objections.
- `src/server/prd/prd-engine.server.ts`, `prd-amend.ts` — PRD becomes a PIC section; semantic amendment with the regex path as fallback.
- `src/server/design-director.server.ts`, `design-finisher.server.ts`, `themes.server.ts` — consume the committed design contract instead of re-deciding.
- `src/server/visual-qa.server.ts` — split functional and craft passes.
- `src/server/intent-targets.server.ts`, `edit-scope-guard.server.ts` — become fallbacks behind the semantic classifier.
- `src/server/build-blueprint.server.ts`, `architecture-doc.server.ts`, `project-memory.server.ts` — write through to PIC.

New:
- `src/server/pic/pic-types.ts`, `pic-store.server.ts`, `pic-assemble.server.ts`, `pic-render.ts`, `pic-diff.ts`
- `src/server/understanding.server.ts` — the semantic understanding call + target/surface resolver
- `src/server/design-system.server.ts` — model-authored design system contract
- `src/server/design-system-lint.server.ts` — deterministic enforcement of that contract
- `src/server/edit-classifier.server.ts`, `impact-scope.server.ts`
- `src/server/craft-qa.server.ts`
- `src/server/acceptance-gate.server.ts`

## 3. Database migrations

One migration, additive:
- `project_intelligence` — `project_id` (unique), `version`, `pic` jsonb, `updated_at`. Owner-scoped RLS via the project's owner, explicit `GRANT` to `authenticated` and `service_role`.
- `project_intelligence_history` — append-only per-turn snapshot + diff, for rollback and admin inspection.

No existing table is altered or dropped.

## 4. Model calls and cost

| Stage | When | Model tier | Notes |
| --- | --- | --- | --- |
| Understanding | every non-micro turn | cheap/fast | one call, cached per turn, replaces several regex passes |
| Design system contract | initial build + global redesign only | balanced | persisted, reused on every later turn at zero cost |
| Design/UX/product agents | initial + structural | balanced | deterministic fallback on failure |
| Edit classifier | normal + structural edits | cheap | regex pre-filter short-circuits obvious cases |
| Craft QA | after deploy, non-micro | vision, existing model | second pass alongside today's functional pass |

Micro edits add **zero** model calls — the deterministic path is unchanged. Initial builds add roughly two to three cheap calls plus one balanced call; this sits inside the existing per-turn cost ceiling (`turn-cost-ceiling.server.ts`) and is reported through existing agent telemetry.

## 5. Feature flags

`PETAL_PIC`, `PETAL_UNDERSTANDING`, `PETAL_DESIGN_CONTRACT`, `PETAL_AGENTS_MODEL`, `PETAL_IMPACT_SCOPE`, `PETAL_CRAFT_QA`, `PETAL_ACCEPTANCE_GATE` — each defaults off except the phase currently shipping, each fail-open to today's behaviour, matching the existing `PETAL_ORCHESTRATOR` contract.

## 6. Phases

**Phase 1 — PIC foundation + semantic understanding** (ship now)
- PIC types, store, assembler, renderer, diff; the migration above.
- `understanding.server.ts`: one semantic pass producing product type, platforms, surfaces (marketing / application / both), backend/auth/payments/realtime/storage needs, roles, and a confidence level per decision. Feeds the target resolver so "build me a mobile banking app" resolves to mobile regardless of the stored target, and "landing page for my SaaS" never becomes a dashboard.
- PRD runs for every target, not only web.
- Existing PRD / blueprint / architecture / memory write through to PIC; PIC renders one prompt block replacing three overlapping ones.

**Phase 2 — Design system contract + model-backed design intelligence** (ship now)
- `design-system.server.ts` commits the full spec on the first build: fonts and pairing, type scale, line heights, spacing base, radius set, shadow and surface rules, semantic colour roles, density, navigation pattern (sidebar vs tabs vs top nav, chosen by reasoning about the product), component rules for buttons/inputs/cards/tables/modals/badges, empty/loading/error treatments, mobile nav, breakpoints, animation principles, accessibility floor.
- Persisted in PIC and reused on every later turn, so pages cannot drift and consecutive projects don't converge on one look.
- `design-system-lint.server.ts` enforces it deterministically and feeds violations to the repair loop.

**Then stop and test.** Phases 3–6 (model-backed board with binding conflict resolution; semantic edit classifier + impact graph; craft QA; product acceptance gate) are specified above but are not implemented until Phase 1 and 2 pass the acceptance suite.

## 7. Testing strategy

Real end-to-end builds, one per archetype, run after each phase and compared against a pre-change baseline: marketing landing page, SaaS application, marketplace, fintech application, mobile application, web + mobile product, backend/API, browser extension. Each is then given a follow-up edit ("make the dashboard darker", "add team members", "change the entire website design") to check the edit path. Unit tests extend the existing `src/server/__tests__` suite for PIC assembly, target resolution and design-contract linting.

## 8. Rollback

Every flag off restores today's pipeline exactly — new modules are additive and fail-open. PIC rows are versioned with per-turn history, so a bad commit can be reverted without touching the PRD or blueprint stores, which keep working independently throughout.

## 9. Success metrics

Build success rate, Vite failure rate, repair invocations per build, recovery calls, generation latency, tokens per turn, functional QA defects per build, craft QA defects per build, edit success rate (did the turn do what was asked), and target-resolution accuracy across the eight archetypes. Tracked through the existing pipeline telemetry and surfaced at `/admin/pipeline`.

## 10. Scope guarantee

Additive throughout. The PRD engine, blueprint system, project memory, repair modules, verification, deployment, visual QA, credit system, model routing, target support, backend kits and integrations all remain in place; the only refactors are the write-throughs that make them feed PIC.
