# Make every Petal landing page hit Flowy quality

## Why the SaaS one failed

Comparing your two screenshots, both came out of the same generator but only one followed the moves that make a landing page feel alive:

| Move | Flowy (good) | PipelinePilot (bad) |
|---|---|---|
| Hero visual above the fold | Real generated photo with floating "5 Days to Flow" card | None — dashboard mockup buried below a screen of empty dots |
| Headline | Big bold display sans, two lines, marker-highlight on "flow" | Tiny "Streamline Your Sales" eyebrow lost in whitespace |
| Subhead | 3 lines, real body weight | Generic paragraph with no hierarchy difference from eyebrow |
| Primary CTA | Filled pink pill | Bare text link with `→` arrow |
| Secondary CTA | Outlined pill | Another bare text link |
| Background | Soft tonal wash | DotPattern occupying ~70% of the fold |
| Brand mark | Filled magenta dot logo | Generic outline sparkle |

Root cause: the `modern-saas` FX recipe is suggestion-grade, not contract-grade. When the model is given a B2B brief it falls back to "clean SaaS" — exactly the banned default the director prompt says not to pick — because nothing downstream forces a hero composition, a hero image, or filled CTAs.

## The fix — five targeted changes

### 1. Hero Contract (hard rule, all landing pages)
New file `src/server/hero-contract.server.ts`. One string block injected into the system prompt for any route that is a landing/marketing page. It defines a non-negotiable hero shape:

- Order: eyebrow badge → H1 (display font, fluid clamp ≥ 40px mobile / ≥ 72px desktop, max 2 lines, one word visually emphasized via highlight/gradient/underline) → 2–3 line subhead in muted body color → **filled primary Button + outline/ghost secondary Button side-by-side (never bare `<a>…→` links)** → hero visual occupying ≥ 40% of the fold height.
- Hero visual must be one of: generated photographic image, product mockup framed in `BrowserMockup`/`PhoneMockup`, abstract MeshGradient + floating decorative card, or 3D scene. Never just a pattern background alone.
- Density rule: hero section's vertical padding ≤ 96px top/bottom on mobile; no empty `min-h-screen` heros.

Wire it into `generate.server.ts` next to the existing blueprint block.

### 2. Force a generated hero image for SaaS/B2B briefs
Today image generation triggers for consumer/lifestyle templates but not for `saas-landing`, `dashboard-app`, etc. Update `image-generation.server.ts` (or the equivalent caller in `generate.server.ts`) so any landing page in the `saas` / `internal-tool` / `ai-tool` verticals gets one mandatory hero asset — either an abstract product render or an environment photo — referenced in the scaffold stub. Flowy got a photo; PipelinePilot got nothing. Parity.

### 3. Upgrade the `modern-saas` FX recipe
In `design-director.server.ts` `FX_RECIPE_DETAILS["modern-saas"]`: replace "DotPattern background" with "MeshGradient or AuroraBackground behind hero copy, DotPattern allowed only as a secondary section divider." Add explicit requirement: "Primary CTA = ShimmerButton or filled Button (variant=default); secondary = outline Button. Never plain anchor + arrow."

Also remove `modern-saas` as the default fallback in `pickFxRecipe`'s `default:` branch — fall back to `agency-portfolio` so unknown briefs get the more expressive recipe rather than the most restrained one.

### 4. Post-stream Hero Linter
New tier in `src/server/pipeline/` (e.g. `tier-hero-discipline.ts`) that runs after files are emitted on initial builds. For the home route file it checks:

- Contains at least one `<Button>` import from `@/components/ui/button` rendered inside the hero section.
- Hero section does NOT consist solely of an anchor + `ArrowRight` icon for its CTA.
- If `saas`/`landing` archetype: an `<img>` or hero-image component is rendered in the first section.
- First section's outermost class list does not include both `min-h-screen` and only-pattern background.

On violation: trigger the existing self-recovery loop with a targeted patch prompt ("Rebuild the hero per Hero Contract: …"). One retry max, then ship anyway.

### 5. Calibration examples in the Director system prompt
Append a tiny "good/bad" exemplar pair to `DIRECTOR_SYSTEM` in `design-director.server.ts`:

- ✅ Good: Flowy-style — filled pill CTA, display headline with highlight, hero photo with floating stat card.
- ❌ Bad: PipelinePilot-style — eyebrow-as-headline, bare text+arrow CTAs, dot pattern as the entire hero.

Two paragraphs, ~120 tokens. Calibrates the director without bloating context.

## Files touched

```text
src/server/hero-contract.server.ts          (new)
src/server/design-director.server.ts        (recipe + fallback + exemplars)
src/server/image-generation.server.ts       (force hero image for SaaS verticals)
src/server/generate.server.ts               (inject hero contract block)
src/server/pipeline/tier-hero-discipline.ts (new linter tier)
src/server/pipeline/staged-orchestrator.ts  (register the new tier)
.lovable/plan.md                            (Phase 19 entry)
```

## Out of scope (deliberately)

- No new motion/3D primitives — the kit already has them; the problem is the model not reaching for them on SaaS briefs.
- No changes to consumer/editorial recipes — Flowy proves those work.
- No template/route changes — `saas-landing` template is fine; the failure is composition, not routing.

## Verification

Re-run the PipelinePilot prompt after shipping. Expect: hero photo or mockup at top, filled primary + outline secondary CTAs, display H1 with one highlighted word, no full-fold dot pattern. If any of those still missing, the hero linter should auto-retry once.

---

## Phase 19 — Shipped (Hero Contract + Director calibration)

**Shipped:**
- `src/server/hero-contract.server.ts` — new. Non-negotiable hero composition block (eyebrow → highlighted H1 → subhead → filled+outline Button pair → real hero visual). Extra SaaS addendum when brief is detected as SaaS/B2B/internal-tool/ai-tool via `classifyAppShape`. Bans bare `<a>...→` CTAs and full-fold DotPattern heroes.
- `src/server/design-director.server.ts` — `FX_RECIPE_DETAILS["modern-saas"]` rewritten to require MeshGradient hero background + filled Button CTAs + floating decorative card on mockup. `pickFxRecipe` default fallback changed from `modern-saas` → `agency-portfolio` (or `calm-editorial` when motion=still). `DIRECTOR_SYSTEM` gained Flowy ✅ / PipelinePilot ❌ calibration paragraph.
- `src/routes/api/generate.ts` — Hero Contract block appended to system prompt on both monolithic and staged paths, gated by `isInitial` + marketing subtype.

**Deferred (lower priority):**
- Hero-discipline lint tier (plan item #4) and forced SaaS image generation (plan item #2) — re-evaluate after observing whether the prompt-level changes alone close the Flowy/PipelinePilot quality gap on the next round of builds. The petal-image:// instruction already exists; the Hero Contract now mandates its use for SaaS mockups.
