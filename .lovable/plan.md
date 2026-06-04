
## Diagnosis (grounded, not theoretical)

Petal already ships a full block library — Navbar, Hero, Features, Pricing, FAQ, Footer, AuthCard, AppShell, KpiGrid, ProductCard, etc. — in `scaffold-kit-blocks-2/3/4.ts`. The manifest of these blocks is rendered by `kit-manifest.server.ts` and injected into the monolithic build prompt by `dynamic-prompts.server.ts:619`.

**But the staged pipeline — the path that actually runs first — does not use it.** Two concrete defects in `src/server/pipeline/stage-plan.server.ts`:

1. The planner's `SYSTEM_PROMPT` (line 102) never receives `renderKitManifestBlock()`. The planner literally does not know `@/components/blocks/*` exists.
2. `MARKETING_SYNTH` (line 229) and `synthAppSurfaceFor` (line 239) hard-code plan entries that tell Stage 2 to **author from scratch** the very components the kit already ships — `Hero.tsx` (220 est_lines), `Pricing.tsx` (200), `Features.tsx` (160), `Faq.tsx` (130), `Footer.tsx` (150), `Navbar.tsx` (130), `AuthCard.tsx` (220). When `repairBusinessAppPlan` runs (line 280), it deterministically splices these in.

Result for every business-app build: 7–11 long files × ~3,500–5,000 tokens each go through the model. That's the surface area that produced today's `Pricing.tsx → "Fixed. Fixed. Fixed."` truncation. The recovery code we shipped this morning is treating the symptom; this plan removes the cause.

## The fix, in three layers

### Layer 1 — Show the planner the blocks (~30 LOC)

In `stage-plan.server.ts`:

- Import `renderKitManifestBlock` from `../kit-manifest.server`.
- Append it to the system prompt, after the LAYOUT ARCHETYPE rules, with one sentence: *"You MAY plan a thin composition file that imports these blocks. You MUST NOT plan a file whose purpose duplicates a block listed below."*
- Add a planner post-check: any planned path that matches a known block name (`/marketing/(Hero|Pricing|Features|Faq|Footer|Navbar|Testimonials)\.tsx`, `/app/AuthCard\.tsx`) is dropped and replaced by composition.

### Layer 2 — Replace MARKETING_SYNTH with COMPOSITION_SYNTH (~80 LOC)

Today: 7 long files, each authored by Gemini with a 200-line contract.

After: **one** file, `src/sections/Landing.tsx`, planned with `est_lines: 90` and `purpose` that reads:

> Compose the landing page by mounting (in this order): `NavWithCta`, `HeroSplit` (or a Hero block variant matching the brand vibe), `LogosGrid`, `StatsBand`, `TestimonialsCards`, `PricingTable`, `FaqAccordion`, `CtaCentered`, `FooterColumns` — all imported from `@/components/blocks/*`. Supply real domain copy as props (5–7 features, 3 pricing tiers, 6 FAQ items, named testimonials). DO NOT hand-roll any section's layout — every section's JSX comes from a block import.

Stage 2 then generates ONE small file whose token surface is ~600 tokens of copy props, not 5,000 tokens of Tailwind. Truncation class of failure is gone by construction.

Same shape for the app surface: replace `synthAppSurfaceFor`'s `AuthCard` entry (220 lines) with a 60-line composition file that imports `SignInCard` + `SignUpCard` from blocks. Keep the domain-specific app entries (`ContactsTable`, `Pipeline`, etc.) since those *are* legitimately bespoke per vertical — but route their layout shell through `SidebarShell` from blocks instead of authoring `AppShell.tsx` from scratch.

### Layer 3 — Fill the one real gap: per-brand Hero mock (~120 LOC, one-time)

The only marketing section that legitimately varies per brief is the Hero's mocked product-visual panel. Today's blocks have generic heroes. Add 3 hero block variants to `scaffold-kit-blocks-2.ts`:

- `HeroSplitWithDashboardMock` — split layout, right side renders a generic dashboard chrome (window dots, sidebar stub, 3 stat tiles, fake chart). Accepts `productName`, `headline`, `subhead`, `primaryCta`, `secondaryCta` as props.
- `HeroCenteredGradient` — centered, gradient text, no mock (good for AI tools and creative apps).
- `HeroProductScreenshot` — accepts an `imageSrc` prop for cases where an image asset is available.

Planner picks ONE variant by vibe (already known via `designDirectionBlock`). No model call authors a mock; the mock IS the block.

## What this changes

- **Initial-build token surface drops ~80%** for business-app and marketing archetypes. One small composition file replaces 7 large ones.
- **Truncation / "Fixed. Fixed. Fixed." class of failure goes away** because no single file is large enough to hit the cap. The recovery code from this morning becomes dead and can be deleted in a follow-up.
- **Visual quality is *more* consistent**, not less — every page meets the contract because the contract IS the block source, hand-authored and parser-validated at Petal's own build time.
- **Edit turns get better** — "darken the hero" is a className override or a variant swap on one block import, not a regenerate-the-whole-component round trip.
- **Mobile / domain-specific work is untouched** — `KIT_BLOCK_FILES_MOBILE` and the domain-specific app components (`ContactsTable`, `Wallet`, `Workspace`, etc.) keep going through the LLM, because those are legitimately bespoke. We're only stopping the LLM from re-authoring solved chrome.

## Out of scope (deliberately)

- The composer/chat UX, triage, billing, mobile preview, archetype detection — all stay.
- Edit-mode patching for arbitrary user code post-initial-build keeps its current path.
- The monolithic `write_project` fallback stays as the safety net until phase 2 proves stable.
- No new orchestration concepts (no "slot-fill" stage as I proposed yesterday — the existing Stage 2 just emits a composition file, same machinery).

## Rollout

1. **Phase 1 (this PR):** Layer 1 + Layer 2. Wire kit-manifest into the planner. Replace MARKETING_SYNTH with COMPOSITION_SYNTH. Replace `AuthCard` synth with a `SignInCard`/`SignUpCard` composition. Behind no flag — this is the new default.
2. **Phase 2 (follow-up):** Layer 3 — add the three hero variants. Once they're in, allow the planner to compose the Hero too.
3. **Phase 3 (cleanup):** Delete the truncation classifier, syntax-retry queue, and `looksLikeTruncation` we shipped this morning. They become unreachable.

## The one decision I need from you

The planner uses `google/gemini-3.5-flash` for the manifest call. After Layer 1+2, the *only* slot-fill content goes through `google/gemini-3-flash-preview` in Stage 2. That's already configured. **I'm planning to keep both model choices unchanged** — no model swap, no schema changes, smallest possible blast radius. OK with you?

If yes, I'll ship Phase 1 (Layers 1 + 2) and stop. Phase 2 and Phase 3 come in separate turns.
