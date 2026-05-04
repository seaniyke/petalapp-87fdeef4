## Why Petal-built sites look the same

I traced this through `scaffold-kit.ts`, `examples-pack.ts`, `dynamic-prompts.server.ts`, `kit-manifest.server.ts`, and `design-director.server.ts`. The cause is **not** missing primitives — we already ship ~40 shadcn primitives + layout helpers (Container/Stack/Inline/Grid) + chart + theme. It's three other things:

1. **The kit ships atoms, not sections.** Lovable, v0, and shadcn-blocks/shadcnblocks (898+ marketing blocks) ship *composed sections* — Hero, Features, Testimonials, Pricing, FAQ, CTA, Footer, Bento, Stats, Logo Cloud — with multiple visual variants each. Petal ships only the lego bricks. The model has to invent the section layout from scratch every turn, and LLMs converge on the same "centered hero + 3-up feature grid + cards" because that's the training-data mode.
2. **Examples-pack has section examples but they're variant-poor.** We have exactly one Hero Centered Gradient, one Hero Split Screenshot, one Logo Cloud, one Feature Band, one Pricing 3-tier. No editorial hero, no asymmetric hero, no bento, no stats band, no testimonials wall, no FAQ accordion, no CTA banner, no footer variants. So even when the model reaches for an example, the *shape* is the same.
3. **Design Director picks a vibe but the kit can't execute it.** The director may say "brutalist-mono" or "warm-editorial", but every section block the model can reach for is the same neutral SaaS card. We need block variants tagged by vibe so the director's choice actually changes the output shape.

## What to build

### A. Add ~12 missing UI primitives (atoms)

Things real apps need that we don't ship today, causing the model to hand-roll them inconsistently:

- `marquee.tsx` — horizontal logo/testimonial scroller (extremely common, currently faked badly)
- `kbd.tsx` — keyboard shortcut pill
- `code-block.tsx` — syntax-styled `<pre>` with copy button (devtool/landing pages)
- `empty-state.tsx` — icon + title + description + action (we have one example, no primitive)
- `stat.tsx` — big number + label + trend chip (KPI atom)
- `timeline.tsx` — vertical event list with dots/connector
- `feature-icon.tsx` — bordered/tinted icon tile in 3 variants
- `gradient-text.tsx` + `gradient-blob.tsx` — controlled gradient utilities (stops the model rolling random `bg-gradient-to-br` chains)
- `section.tsx` — `<Section eyebrow title description align>` wrapper that standardizes section headers
- `divider.tsx` — labeled divider
- `rating.tsx` — star rating
- `prose.tsx` — typography wrapper for long-form content (blog posts)

### B. Add a "blocks" layer (composed sections, the real fix)

Create `src/components/blocks/*` in the scaffold, plus a parallel index in `examples-pack.ts`. **Each section gets 3 variants** so the director's vibe choice has somewhere to land:

| Section | Variants |
|---|---|
| Hero | `hero-centered`, `hero-split-image`, `hero-editorial` (asymmetric, oversized type) |
| Features | `features-grid-3`, `features-bento`, `features-alternating-rows` |
| Stats | `stats-band`, `stats-grid`, `stats-with-chart` |
| Testimonials | `testimonials-cards`, `testimonials-marquee`, `testimonials-quote-hero` |
| Pricing | (keep 3-tier + comparison) add `pricing-single-product` |
| FAQ | `faq-accordion`, `faq-two-column` |
| CTA | `cta-centered`, `cta-split`, `cta-gradient-band` |
| Footer | `footer-columns`, `footer-minimal`, `footer-newsletter` |
| Logo Cloud | `logos-grid`, `logos-marquee` |
| Header/Nav | `nav-bar`, `nav-with-cta`, `nav-with-search` |

Each block ≤120 lines (within file-budget cap), uses kit primitives, accepts `className` for vibe-driven overrides.

### C. Wire the new surface into the prompts

Three prompt-side changes so the model actually *uses* this:

1. **Kit manifest auto-derive already exists** (`kit-manifest.server.ts`) — it will pick up the new primitives automatically. Extend it to also enumerate `src/components/blocks/*` so the model sees `<HeroEditorial />`, `<FeaturesBento />`, etc., as first-class.
2. **Add a new `sections` snippet in `dynamic-prompts.server.ts`** triggered by `/landing|home|page|hero|features|pricing|testimonial|faq|cta|footer/` that says: "Compose pages by picking ONE variant per section from `@/components/blocks/*`. Do not hand-roll a hero — pick `HeroCentered`, `HeroSplitImage`, or `HeroEditorial`. Mix variants across sections — do not use all 'centered' variants on the same page."
3. **Bridge Design Director → block selection.** In `design-director.server.ts`'s `renderDesignDirectionBlock`, append a "block picks" hint table mapping vibe → preferred variants:
   - `warm-editorial` → `HeroEditorial`, `FeaturesAlternatingRows`, `TestimonialsQuoteHero`, `FooterMinimal`
   - `brutalist-mono` → `HeroEditorial`, `FeaturesBento`, `StatsBand` (no rounded), `FooterColumns`
   - `playful-maximalist` → `HeroCentered` w/ gradient blob, `FeaturesBento`, `TestimonialsMarquee`
   - `swiss-grid` → `HeroSplitImage`, `FeaturesGrid3`, `StatsGrid`, `FooterColumns`
   - default → mix any

### D. Examples-pack additions

Add ~10 example files demonstrating *page assembly* (not just sections) so the model sees the composition pattern:
- `landing-saas-product.tsx` (Nav + HeroSplit + LogosMarquee + FeaturesBento + Pricing + FAQ + CTA + Footer)
- `landing-editorial-portfolio.tsx`
- `landing-ecommerce-single-product.tsx`
- `landing-agency-services.tsx`
- `app-shell-with-sidebar.tsx`
- `marketing-blog-index.tsx` + `blog-post-detail.tsx`

### E. Out of scope on purpose

- No new dependencies (no embla beyond what carousel already pulls, no framer-motion mandatory). Keep edge-runtime safe.
- Not adding Three.js / 3D / fancy WebGL — Worker-incompat and bundle bloat.
- Not pulling in shadcn-blocks copy-paste wholesale — license-mixed and many depend on Next.js.

## Technical details

**File budget impact.** `scaffold-kit.ts` is already 3,846 lines. Adding ~12 atoms (~30 lines each) + ~25 blocks (~80 lines each) ≈ +2,400 lines → ~6,300 lines total. Still bundled server-side, no runtime impact. We can split into `scaffold-kit-blocks.ts` to keep diffs reviewable.

**Kit manifest extension.** Today it parses `src/components/ui/*.tsx`. Update `getKitManifest()` and `renderKitManifestBlock()` to also walk `src/components/blocks/*.tsx`, with a separate header in the rendered block ("Section blocks — prefer these over hand-rolling").

**File-budget gate.** `fileBudget` snippet allows ≤180 lines/6 KB. All new blocks designed under 120 lines so model can copy-with-edits without tripping the gate.

**Backward compatibility.** All new files are `overwrite: true` additions; nothing replaces existing kit files. Old projects regenerated will gain the blocks for free on next turn.

**Variant naming convention.** `<Section><Variant>` PascalCase, default export per file: `HeroEditorial.tsx` exports `HeroEditorial`. Matches kit-manifest extractor's existing regex (no parser change needed).

## Phasing

1. **Phase 1 (this PR):** atoms (A) + 3 hero variants + 3 features variants + sections snippet + manifest extension. Smallest change that proves the pattern end-to-end.
2. **Phase 2:** remaining blocks (testimonials/pricing/FAQ/CTA/footer/nav) + page-assembly examples.
3. **Phase 3:** Design Director → block-pick hints, plus a small eval that renders 5 prompts and checks the diff in chosen blocks across vibes.

Want me to proceed with Phase 1, or should I bundle Phase 1+2 in one go?
