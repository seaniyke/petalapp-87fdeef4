# Petal Design Quality Lift — one-shot, pipeline-safe

## Why not a full "Lovable clone in one go"

Petal already has the same building blocks Lovable uses: `design-director`, `hero-contract`, `dynamic-prompts`, `build-blueprint`, `templates.server`, 10+ `scaffold-kit-*` modules, `generation-quality-gate`, `validate-styles`, `examples-pack-{1,2}`, `renderable-shell`, staged pipeline (`stage-wireup`, etc.). The gap isn't missing infrastructure — it's that the **taste signal** the model receives is thin and the **anti-sameness guardrails** are weak. The fix is a prompt+library+gate change, not a pipeline rewrite.

Rewriting the pipeline "end-to-end in one turn" would touch `generate.server.ts`, staged pipeline, verifiers, and scaffold-kits simultaneously. That is exactly the destabilization you told me to avoid.

## Scope (single coherent batch, ~6 new files, 3 edits)

### 1. New: `src/server/design-taste.server.ts`
A single strong "design taste" prompt block Petal injects into every build. Codifies the rules from Lovable's own design-craft doc: bold aesthetic commitment, no default fonts (Inter/Poppins) unless asked, no purple-on-white gradients, distinctive typography pairs, semantic tokens only, one hero animation over scattered micro-interactions, complexity-matches-vision. Explicit "sameness refusals" list (the exact clichés to reject).

### 2. New: `src/server/section-library.server.ts`
Curated catalog of ~40 landing-page section variants (hero A/B/C/D, features grid vs bento vs zigzag, social-proof marquee vs logo-wall vs testimonial-card, pricing table vs card-stack, FAQ accordion vs two-column, CTA banner vs split, etc.) with short prose descriptions and Tailwind hints. Petal's prompt tells the model to pick a **non-repeating combination** per project archetype. This is what breaks the "every landing page looks the same" pattern.

### 3. New: `src/server/palette-presets.server.ts`
The 26 curated palette presets + 15 font pairs from Lovable's `questions_design_preferences` doc, exposed as a server helper. `design-director` picks a domain-appropriate palette+pair per project archetype (already partly inferred) and passes it verbatim into the prompt as **locked tokens** — so the model can't drift back to indigo-on-white.

### 4. New: `src/server/anti-sameness.server.ts`
A lightweight post-generation check on landing pages: scans generated `src/routes/index.tsx` for the sameness fingerprints (indigo/purple gradient on white, `font-sans` with no custom import, hero with only one CTA button and no supporting visual, missing sections from the landing checklist). Returns notes, never blocks. Feeds into `generation-quality-gate`.

### 5. New: `src/server/landing-checklist.server.ts`
Enforces the checklist already in memory (nav + hero + social proof + features + how-it-works + showcase/stats + testimonials + pricing + FAQ + final CTA + footer) as a soft-required set for landing archetypes. Missing sections → auto-note back to the model in the same turn.

### 6. Edit: `src/server/dynamic-prompts.server.ts`
Wire the four new modules into the assembled system prompt for build turns. One insertion point, guarded so it only activates on `archetype ∈ {landing, marketing, saas-home, portfolio}` — dashboards/tools stay unchanged.

### 7. Edit: `src/server/generation-quality-gate.server.ts`
Call `anti-sameness` + `landing-checklist` after generation. Emit notes into the existing gate result shape. No new failure modes — additive only.

### 8. Edit: `src/server/petal-capabilities.server.ts`
Add a two-line "design commitments" section so Petal, when discussing with the user, says the same things it enforces in prompts (consistency between chat voice and generated output).

## What I am explicitly NOT doing this turn

- Not editing `generate.server.ts`, `stage-wireup.server.ts`, `stage-parallel-scaffold.server.ts`, any verifier, `renderable-shell`, `runAllRepairs`, or the staged pipeline orchestration.
- Not modifying existing `scaffold-kit-*` files (only reading them).
- Not touching `hero-contract` or `build-blueprint` internals.
- No prompt-block reordering — only additive injection at one known-safe point.
- No new npm dependencies.
- No DB migrations.

## Risk

- Blast radius: prompt block grows by ~4-6KB. Context budget headroom already exists (`context-budget.server.ts` manages this).
- Rollback: revert one commit; the four new files are inert unless imported, and the three edits are additive at guarded insertion points.
- Testing: existing golden-apps tests under `src/server/__tests__/golden-apps/` still pass because prompt additions are purely instructional.

## What this actually delivers

- Landing pages stop rhyming with each other (section library + locked palettes).
- No more indigo-on-white default (taste block + palette lock).
- Every landing hits the full section checklist (landing-checklist gate).
- Petal's chat voice matches what it ships (capabilities block updated).

## What it does NOT deliver (be honest)

- Not "all of Lovable's capabilities". Lovable also has: their own design-directions renderer, a huge internal component gallery, per-industry template packs shipped as real code, and years of prompt tuning against telemetry. Matching that fully is a multi-week program, not one turn.
- Won't make dashboards prettier — this batch is scoped to marketing/landing archetypes because that's your stated complaint. Extending to dashboards is a follow-up.

Approve and I implement all 8 changes in one turn. Reject and tell me which parts to cut or reorder.
