## Problem

Same "Build me a CRM SaaS" prompt → the marketing surface still looks like a generic AI placeholder: a centered H1, one subhead, Login/Sign Up buttons, three bordered cards. No navbar, no hero visual, no social proof, no pricing, no footer above the fold, and no real composition.

Two root causes in the pipeline (no UI changes needed):

1. **Synthesised marketing plan is too thin.** `MARKETING_SURFACE_FILES` in `src/server/pipeline/stage-plan.server.ts` only seeds Hero / Features / Pricing / Footer with one-line `purpose` strings. There's no Navbar, no Testimonials/Logos, no FAQ, no CTA band. The Hero `purpose` doesn't demand a navbar, eyebrow badge, gradient/visual, or trust row — so the model ships the bare minimum.
2. **Scaffold prompt has no marketing quality bar.** `scaffoldOne` in `src/server/pipeline/stage-scaffold.server.ts` uses one generic system prompt for every file. There are extra `rootRules` for `src/App.tsx`, but nothing for `src/components/marketing/*`. The line cap (240) and token cap (2800) are also tight for a real hero/pricing section.

## Changes (server-only, no UI work)

### 1. `src/server/pipeline/stage-plan.server.ts` — richer marketing scaffold

- Expand `MARKETING_SURFACE_FILES` to seven components in this order:
  - `Navbar.tsx` — sticky top nav, logo wordmark, product/pricing/docs links, Sign in + primary CTA.
  - `Hero.tsx` — eyebrow badge, two-line headline with gradient accent on one phrase, supporting subhead, dual CTA (primary → `/auth`, secondary ghost), trust row ("Trusted by 2,000+ teams" + 4–6 muted logo wordmarks), product mock visual (gradient panel with mocked dashboard chrome — no external image).
  - `Features.tsx` — bento/3-col grid, 6 cards with lucide icons, domain-specific copy. Mobile `grid-cols-1`, `sm:grid-cols-2`, `lg:grid-cols-3`.
  - `SocialProof.tsx` — 3 testimonial cards with avatar initials, role, company. Mobile stacked, `md:grid-cols-3`.
  - `Pricing.tsx` — 3 tiers (Free / Pro / Team) with feature checklists, "Most popular" ring on Pro, CTA per tier.
  - `Faq.tsx` — 5–6 Q&A using shadcn Accordion.
  - `Footer.tsx` — 4 columns (Product / Company / Resources / Legal) + copyright + small wordmark.
- Update each `purpose` string to be specific and composition-aware (mention navbar height offset, hero min-h, gradient direction, badge style, container max-w, spacing rhythm `py-20 sm:py-28`).
- Update `injectRootViewIfMissing` so the `/` route renders `Navbar + Hero + Features + SocialProof + Pricing + Faq + Footer` in that order, and the marketing surface is wrapped in `<main>` with proper semantic landmarks.
- Bump `business-app` file budget by +3 to accommodate Navbar/SocialProof/Faq.

### 2. `src/server/pipeline/stage-scaffold.server.ts` — marketing quality rules

Add a `marketingRules` block (sibling to `rootRules`) that activates when `file.path.startsWith("src/components/marketing/")`:

- Mandatory: real domain copy (no "Welcome to Our X"), navbar must be sticky with backdrop-blur, hero must include eyebrow badge + gradient text accent + trust row + visual mock panel, every section needs `container mx-auto px-6` + `py-20 sm:py-28`, headings use `text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight`, sub copy `text-lg text-muted-foreground`, cards use `rounded-2xl border bg-card/50 backdrop-blur` with hover states, all grids declare a mobile base (`grid-cols-1`) before responsive prefixes.
- Forbidden: centered single-column hero with just headline+buttons, plain bordered cards with no icon/visual, "Welcome to Our …", lorem-ish copy, missing navbar, missing footer.
- Raise caps for marketing files: `lineCap = min(280, est_lines + 80)`, `tokenCap = 3400`.

### 3. `src/lib/app-shape-classifier.ts` — propagate to renderShapeBlock

Append a "Marketing surface bar" line to the prompt block whenever `archetype === "business-app"`: lists the seven required components and the "no centered-headline-only hero" rule, so even the monolithic path (not just the staged synthesizer) gets the bar.

### 4. `src/server/render-risk-linter.ts` — R7 landing-page smell

Add a soft warning (no autofix) when `src/App.tsx` for a `business-app` brief mounts fewer than 4 of `[Navbar, Hero, Features, SocialProof, Pricing, Faq, Footer]`. Logged to telemetry so we can measure improvement; doesn't block ship.

## Out of scope

- No composer / preview / device-frame UI changes.
- No model swap.
- No design-system token changes — using existing semantic tokens only.
- Dashboard/product surface untouched; this plan only fixes the marketing side.

## Technical notes

- Files edited: `src/server/pipeline/stage-plan.server.ts`, `src/server/pipeline/stage-scaffold.server.ts`, `src/lib/app-shape-classifier.ts`, `src/server/render-risk-linter.ts`.
- No new dependencies. All icons come from existing `lucide-react`; Accordion from existing `@/components/ui/accordion`.
- Token budget impact: +3 files × ~3000 tokens ≈ one extra Stage-2 batch round-trip per business-app build. Acceptable.
