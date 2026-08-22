# Petal Generation Engine 2.0 — audit and phased build

## Part 1 — Audit of what exists today

I read the live pipeline before writing this. Petal is already far past "prompt → LLM → code": there is a PRD engine, a planning board, a design director, a visual QA stage and project memory. The weaknesses are specific, and they are not the ones the brief assumes.

### Current flow (verified)

```text
POST /api/generate
  → fast-triage (build vs discuss vs clarify)
  → PRD engine        resolvePrdForTurn  (turn 1 authors, later turns amend)
  → design direction  design-director + themes + palette floor
  → planning board    agents/orchestrator  (product, ux, design, architecture,
                                            database, backend, security)
  → prompt assembly   PRD block + design block + decision block + blueprint
                      + architecture + hero/brand/composition contracts
  → model streams file ops
  → deterministic healers (~40 modules: imports, styles, palette, layout,
                           interaction, router, kit closure, esbuild verify)
  → builder → deploy → visual QA (screenshots → vision model → defects)
  → repair loop (repair-all, defect-judge, scope-repair)
  → memory writer + blueprint/architecture persistence
```

### Where it actually breaks

1. **The planning board does not think.** Every agent in `src/server/agents/registry.ts` is `modelProfile: "deterministic"` with `budgetMicroUsd: 0`. The "UI/Design Intelligence Agent" the brief asks for exists in name only — it re-states PRD fields. Real design judgement (sidebar vs tabs, density, hierarchy) is never reasoned about.
2. **The board is advisory, not binding.** `orchestrateTurn` returns a text block appended to the prompt. Blocking objections are counted in telemetry and then ignored — nothing gates generation on them.
3. **Design consistency is enforced by codemods, not by a design system.** `palette-floor`, `tailwind-token-sweep`, `design-finisher` repair styling after the fact. There is no single committed, machine-checkable project design spec that every page must consume, so pages still drift and the fixes fight each other.
4. **Edit classification is pure regex.** `prd-amend.ts`, `edit-intent.server.ts`, `intent-targets.server.ts` and `edit-scope-guard.server.ts` are keyword lists. This is exactly the class of bug we just fixed for "change the entire website design" — and the next phrasing will miss again.
5. **No semantic impact scope.** File selection is string matching plus a route graph. Nothing computes "checkout page → checkout component → primary CTA → button tokens", and nothing declares what must stay untouched.
6. **Memory is 30 key/value strings.** Good for tone and taste, useless as the "source of truth" the brief describes. The PRD, architecture and design system are persisted separately in `project_blueprints` with no unified read.
7. **Visual QA only reports geometry defects.** By design it drops "generic-looking", "weak hierarchy", "inconsistent buttons" as subjective — the exact defects driving the complaint that apps look plain.

### Root causes (short list)

- Determinism was chosen everywhere for cost and latency; the price is no judgement where judgement is the product.
- Quality is enforced downstream (repair) rather than upstream (a committed spec).
- Intent understanding is lexical, so it degrades on unseen phrasing instead of reasoning.

## Part 2 — Proposed architecture

One shared, persisted **Project Intelligence Context** (PIC) per project: PRD + design system + architecture + decision log + constraints. Every stage reads it; every stage may amend it; it is versioned per turn.

```text
prompt → intent classifier (semantic) → PIC load
       → planning board (model-backed where it matters)
       → PIC commit (PRD + design system + architecture)
       → impact scope (affected / protected)
       → build → heal → deploy → QA (geometry + craft) → bounded repair
       → PIC update
```

## Part 3 — Phases

### Phase 1 — Project Intelligence Context (foundation)
- New `src/server/pic/` : `pic-types.ts`, `pic-store.server.ts`, `pic-render.ts`.
- One row per project holding PRD, design system, architecture, decisions, constraints, confidence levels. Backed by a new `project_intelligence` table (migration; RLS owner-scoped + service_role grants).
- Existing PRD store and blueprint store keep working and become writers into the PIC — no functionality removed.

### Phase 2 — Design system as a committed contract
- New `src/server/design-system.server.ts`: turn 1 commits a full spec (type scale, spacing base, radius set, semantic colour roles, surface/shadow rules, component styling rules, density, nav pattern).
- Persist in PIC; render as a hard contract block; every page must consume tokens only.
- New `src/server/design-system-lint.server.ts`: fails files that hardcode colours/sizes outside the committed spec, and feeds the repair loop.
- The design agent becomes model-backed (`balanced` profile, small budget) and produces this spec — this is the main fix for "apps look plain".

### Phase 3 — Model-backed planning board
- Upgrade `product`, `ux`, `design`, `architecture` agents in `registry.ts` to escalate to a model on initial builds and on structural edits; keep deterministic paths as the fallback and for micro turns.
- Make blocking objections real: `orchestrator.server.ts` gains a gate that either resolves the objection or narrows scope before generation, instead of only logging it.
- Confidence levels (`confident` / `inferred` / `uncertain`) recorded per decision; only an `uncertain` decision that changes the product may raise the single clarifying question the pipeline already supports.

### Phase 4 — Semantic edit understanding and impact scope
- New `src/server/edit-classifier.server.ts`: classifies each follow-up as visual / feature-add / feature-change / bug / refactor / global, using the PIC as context. Regex path stays as a fast pre-filter and fallback.
- New `src/server/impact-scope.server.ts`: from the classification plus the architecture graph, emits `affected[]` and `protected[]`. Protected files are excluded from write ops unless the classification says otherwise; verification targets affected files plus their dependents.
- Retires the fragile parts of `edit-scope-guard.server.ts` only once the replacement passes.

### Phase 5 — Craft QA
- Extend `visual-qa.server.ts` with a second, separate craft pass: hierarchy, consistency of buttons/cards, density, template-genericness, mobile composition. Kept distinct from the literal-defect pass so taste findings never block a build — they enter the bounded repair loop as improvements.
- Repair entries carry problem / root cause / affected files / fix / verification, and the loop stays bounded (no change to existing caps).

### Phase 6 — Acceptance and telemetry
- Extend the acceptance gate so "compiles" is not "complete": product intent covered, states present, design-system lint clean, no placeholder copy, mobile pass.
- Admin surfaces per-turn PIC diffs and agent reasoning at `/admin/pipeline`.

## Technical notes

- Files changed: `src/server/agents/registry.ts`, `selection.ts`, `orchestrator.server.ts`, `runtime.ts`, `src/server/prd/prd-engine.server.ts`, `prd-amend.ts`, `src/server/design-director.server.ts`, `visual-qa.server.ts`, `edit-scope-guard.server.ts`, `intent-targets.server.ts`, `src/routes/api/generate.ts`.
- New files: `src/server/pic/*`, `design-system.server.ts`, `design-system-lint.server.ts`, `edit-classifier.server.ts`, `impact-scope.server.ts`.
- Database: one new table `project_intelligence` (owner-scoped RLS, explicit grants). No destructive migrations; existing tables keep their readers.
- Cost: model escalation is gated by profile — micro turns stay at zero added spend; initial builds and structural edits add a bounded planning cost tracked in existing agent telemetry.
- Risk control: every new stage is additive and fail-open, matching the current orchestrator contract — any failure degrades to today's behaviour rather than failing a build.

## Sequencing

Phases 1–2 first (they unlock the design quality win), then 3, then 4, then 5–6. Each phase ships behind its own flag and is verified with a real end-to-end build before the next starts.
