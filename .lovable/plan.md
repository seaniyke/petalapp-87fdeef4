# Petal Intelligence Architecture — audit and phased plan

No application code changed. This is the audit of what exists today and the plan to evolve it into a coordinated multi-agent system.

## Headline finding

Petal already has most of the specialist "brains" the target diagram asks for — roughly 20 of them. What it does not have is a **shared context and an orchestrator**. Today each stage reads the raw prompt plus a few ad-hoc inputs, writes into a growing system prompt string, and hands off in a fixed linear order inside one 5,579-line request handler (`src/routes/api/generate.ts`). Decisions are not addressable: the UX pass cannot see what the architecture pass concluded, and nothing can reconcile a conflict.

So this is **not** a rewrite. It is: extract an orchestrator, give the existing passes a typed shared blackboard, add the three genuinely missing agents (Security, Backend/Data, Responsive), and make reconciliation explicit.

## 1. Current flow, as actually implemented

```text
POST /api/generate
  auth → rate limit → credit floor → per-user build lock → turn row
  ↓ Plan Mode v1/v2 (propose scope, may short-circuit for approval)
  ↓ target inference (web / mobile / extension / game)
  ↓ PRD ENGINE          src/server/prd/*      authored turn 1, amended later
  ↓ sub-type router + app-spec (entities/roles/workflows)
  ↓ context assembly    backend schema, integrations, web grounding,
                        project memory, PETAL.md, project knowledge
  ↓ DESIGN DIRECTOR     + themes/templates/palette/anti-sameness/brand
  ↓ blueprint + architecture doc (what the code contains today)
  ↓ hero contract, app composer, archetype, kit blocks, taste, sections
  ↓ prompt cache split (stable prefix / dynamic suffix)
  ↓ phase classifier → smart router → model choice
  ↓ INSPECTOR agent (read-only) → AGENT LOOP (grep/read/codemod/verify)
  ↓ EMIT (single forced write_project | patch_files, streamed)
     └ chunked generation for multi-page work
  ↓ CRITIC agent (deterministic rules + model review of the diff)
  ↓ deterministic repair-all (7 passes) + pre-emit gate (tiers) + autofix
  ↓ persist files → trigger builder (Railway) → deploy
  ↓ builder callback: browser verify + VISUAL QA (vision) → DEFECT JUDGE
  ↓ bounded repair rounds (cost-capped) → self-check → telemetry/billing
```

## 2. Inventory and disposition

| # | System | Where | Call |
|---|---|---|---|
| 1 | PRD engine (types, deterministic, model, amend, acceptance, store) | `src/server/prd/*` | **KEEP** — becomes the shared contract root |
| 2 | App spec (entities/roles/workflows/CRUD depth) | `app-spec.server.ts` | **MERGE** into PRD as the data-model section |
| 3 | Blueprint + architecture doc | `build-blueprint`, `architecture-doc` | **MERGE** into one Architecture record |
| 4 | Design director, themes, templates, palettes, taste, anti-sameness, brand, hero contract, section library, design finisher | 12 modules | **MERGE** behind one Design Intelligence facade; keep internals |
| 5 | Prompt assembly + dynamic prompts + cache split | `dynamic-prompts`, generate.ts | **IMPROVE** — render from shared context, not string accretion |
| 6 | Context budget, file budget, trimming | `context-budget`, `file-budget` | **KEEP** |
| 7 | Project memory (per-project facts, RLS-scoped) | `project-memory.server.ts` | **KEEP** |
| 8 | Model routing: fast triage, phase classifier, smart router, health, kill switch, provider failover | 6 modules | **KEEP** — agents request a *tier*, router picks the model |
| 9 | Inspector + agent loop + agent tools | 3 modules | **KEEP** — the tool-using substrate all agents reuse |
| 10 | Critic | `critic-agent.server.ts` | **IMPROVE** → QA-Code agent under the QA board |
| 11 | Deterministic repairs (7 passes) + ~25 fixers + pre-emit gate tiers | `repair-all`, `pipeline/*` | **KEEP** — cheapest layer, must run before any model |
| 12 | Local verifier, esbuild verifier, render-risk, RLS sanity | 4 modules | **KEEP** |
| 13 | Visual QA (vision) + defect judge (triage) + deploy verify | 3 modules | **KEEP**, extend with a11y/responsive checks |
| 14 | Repair loop (rounds + cost ceiling) + self-recovery + repair ledger | in generate.ts | **IMPROVE** — extract, make defect→agent routed |
| 15 | Telemetry: ai_call_log, ai_call_outcomes, pipeline_tier_events, turns/turn_events, benchmark | tables + modules | **KEEP**, add per-agent rows |
| 16 | Credits/cost: turn cost meter, budgets, post-build settlement | `turn-cost-ceiling`, `credits` | **KEEP** — becomes the orchestrator's budget authority |
| 17 | Failure/retry: structured retry, tool-args salvage, stream continuation, self-healing build lock, watchdogs | 5 mechanisms | **KEEP** |
| 18 | Two-phase gate / capability ask | `two-phase-gate`, `intent-registry` | **KEEP** |
| 19 | Orchestration itself | inline in `generate.ts` | **REPLACE** with an explicit orchestrator |
| 20 | Shared agent context, agent registry, reconciliation | — | **MISSING — build** |
| 21 | Security agent, Backend/Data agent, Responsive agent | partial (RLS linter, backend-quality, layout-hygiene) | **IMPROVE into real agents** |
| 22 | A second live tool loop during emit | — | **NOT NEEDED** — one structured emit stays |
| 23 | Per-agent chat UI / agent names in the product | — | **NOT NEEDED** — Petal stays one voice |

## 3. Proposed architecture

```text
                    ORCHESTRATOR  (phases, budget, deadlines, reconciliation)
                            │  reads/writes
                    ┌───────┴────────┐
                    │ SHARED CONTEXT │  typed, versioned, append-only decisions
                    └───────┬────────┘
   ┌──────────┬─────────┬───┴────┬──────────┬─────────┬────────┐
 Product   Architect    UX    Design     Frontend  Backend  Security
   └──────────┴─────────┴────────┴──────────┴─────────┴────────┘
                    │ proposals + objections
              RECONCILER → PRD v_n → Tech Spec → Build Plan
                            ↓
                    CODE GENERATION (existing emit path, unchanged)
                            ↓
              PREVIEW → QA BOARD (functional / visual / responsive /
                        a11y / security / data) → DEFECT ROUTER
                            ↓
                    REPAIR LOOP (routed back to the owning agent)
```

**Blackboard, not a chat.** Agents never message each other freely. Each writes typed `Decision` records into shared context and may raise an `Objection` against another agent's decision. The orchestrator runs bounded rounds and the reconciler resolves conflicts by a fixed precedence: PRD intent > security > architecture > data > UX > visual design > copy.

### Shared context shape

```ts
TurnContext {
  turnId, projectId, userId, target, budget: { cents, deadlineMs }
  input: { prompt, attachments, history summary }
  prd: VersionedPrd                 // existing type, extended
  architecture: { routes, entities, ownership, libraries, dataFlows }
  design: { direction, palette, type, motion, sections, brand }
  spec: { surfaces, states, contracts }        // derived
  plan: { steps[], files[], risk }
  decisions: Decision[]             // { id, agent, kind, claim, rationale, refs[] }
  objections: Objection[]           // { againstId, agent, severity, ask }
  evidence: { inspector, verifier, visual, deploy }
  defects: Defect[]                 // { id, kind, severity, owner, evidence }
  telemetry: { agentRuns[], cost }
}
```

Persisted per turn (JSONB) so reconnects, repairs and audits read the same truth. Project-level durable slices (PRD, architecture, design direction) keep their existing tables.

### Agent responsibilities (all internal, invisible to the user)

Product (owns PRD + acceptance) · Architect (routes, ownership, libraries) · UX (flows, states, empty/loading/error) · Design Intelligence (direction, palette, type, sections, anti-sameness) · Frontend (component/file plan) · Backend & Data (entities, RLS, migrations, server functions) · Security (auth, secrets, RLS, payment implications) · AI/Logic (model features in the generated app) · Responsive/Mobile (breakpoint contract) · QA board (functional, visual, responsive, a11y, data) · Repair (routes each defect to its owner).

Each agent declares: inputs it reads, decisions it may write, model tier, hard timeout, and a deterministic fallback. **Any agent may be skipped; none may fail a build.**

### Execution profiles (cost control)

| Profile | Trigger | Agents run |
|---|---|---|
| Micro | copy/style edit | none — deterministic path only |
| Standard | ordinary edit | Product(amend), Architect, Frontend, QA |
| Full | first build / new surface / high-stakes domain | all, 2 reconciliation rounds |

Budget is enforced by the existing `TurnCostMeter`: the orchestrator downgrades the profile rather than overspending. Target: Full profile adds ≤ 1 cheap-tier call per agent (Flash-Lite class) plus one reconciliation call; heavy models stay reserved for emit and repair.

### QA and repair

QA agents produce `Defect { kind, severity, owner, evidence }`. The existing defect judge stays as the triage layer. The repair loop routes each blocking defect to its owning agent, which proposes a scoped fix; deterministic fixers still run first and for free. Rounds and cost ceilings stay as they are today.

## 4. Data/storage

- `turn_context` JSONB on the existing `turns` row (no new table needed initially).
- `agent_runs` table: turn_id, agent, profile, model, tier, ms, cost_micro, status, decisions_written, objections_raised → feeds `/admin/pipeline`.
- Reuse `project_blueprints` for the merged Architecture record and `project_memory` for durable facts. No change to credits/billing tables.

## 5. Risks

1. **Latency creep** — mitigated by profiles, parallel agent fan-out, hard per-agent timeouts, and Micro doing zero model work.
2. **Cost creep** — cheap tier for agents, meter-enforced downgrade, benchmark suite watches cost/build.
3. **Refactor blast radius** — `generate.ts` is the highest-risk file in the codebase. The orchestrator is introduced behind a labs flag and runs the *same* underlying functions.
4. **Over-abstraction** — agents must stay thin adapters over existing modules; no new prompt copies.
5. **Reconciliation stalls** — max 2 rounds, then precedence order decides, always.

## 6. Migration strategy and phases

- **Phase A — Shared context (no behaviour change).** Define `TurnContext`, persist it, backfill it from the values `generate.ts` already computes. Existing passes read from it instead of loose variables. Ship behind a flag; output must be byte-identical on the benchmark suite.
- **Phase B — Orchestrator extraction.** Move the phase sequence out of `generate.ts` into `orchestrator.server.ts` with a registry and profiles. Still linear, still the same modules. `generate.ts` becomes transport + billing.
- **Phase C — Decisions and objections.** Existing passes emit typed decisions; add the reconciler with fixed precedence. First real cross-agent behaviour.
- **Phase D — The three missing agents.** Security, Backend/Data, Responsive, built on the existing linters and quality bibles.
- **Phase E — QA board + defect routing.** Unify functional/visual/responsive/a11y under one board; route repairs to owners.
- **Phase F — Observability + benchmark.** `agent_runs`, admin panel, and a benchmark gate: quality up, cost/latency flat or better, before the flag flips to default.

Each phase ships independently, is flag-gated, and is judged on the existing 15-prompt benchmark suite — not on vibes.
