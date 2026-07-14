# Petal — Premium Redesign

Goal: give Petal a distinctive, state-of-the-art visual identity across every user-facing page, without touching the code-generation pipeline or backend.

## Design Direction

- **Aesthetic**: editorial-modern. Big black display type, generous whitespace, warm off-white paper background with a single saturated accent, layered subtle gradients, soft shadows.
- **Typography**: `Instrument Serif` (display, italic accents) + `Geist` (body). Loaded via `<link>` in `__root.tsx`. Existing `font-display` token repointed.
- **Palette**: keep current warm cream base (`--background`), add a deeper ink (`--foreground`), tighten primary to a single confident accent (coral). Retire pastel `mint/butter/coral` tints as decoration; keep as semantic tokens only.
- **Photography**: real human portraits (Unsplash) in testimonials, real product screenshots in showcase, no gradient blobs.
- **Motion**: one signature hero animation (headline reveal + italic word rotate), scroll-in fades on sections. No per-icon micro-animations.

## Scope — pages touched

1. **`src/routes/index.tsx`** (landing) — full section refresh:
   - Hero: oversized editorial headline with rotating italic word, refined composer card, trust row of real logo marks (SVG text logos).
   - Social proof stat strip (numbers, not fake logos).
   - Features: bento grid (1 tall + 2 short + 1 wide) with real product screenshots.
   - How-it-works: numbered horizontal steps.
   - Showcase: device mockup trio pulling from existing `SampleAppShowcase`.
   - Testimonials: human portraits (already partly done), masonry-lean layout.
   - Pricing teaser → linking to existing billing sheet.
   - FAQ accordion.
   - Final CTA banner + refined mega footer.
2. **`src/components/SiteHeader.tsx`** — already text-only; tighten spacing, add subtle scroll-linked border, refine mobile nav trigger.
3. **`src/routes/auth.tsx`** — split-screen: left = editorial marketing panel with rotating quote, right = auth card. Mobile collapses to single column.
4. **`src/routes/projects.tsx`** — grid refinement: larger thumbs, cleaner filter chips, empty state with real illustration slot.
5. **`src/routes/profile.tsx`** — cover band + avatar + settings cards, matches new tokens.
6. **`src/routes/gallery.tsx`** — masonry grid with hover reveal.
7. **`src/routes/coffee.tsx`** — heavier hero, cleaner tip tiers.
8. **`src/styles.css`** — repoint `--font-display`, tighten heading defaults, add `--shadow-editorial`, `--gradient-editorial` tokens. No token deletions (keeps generated apps unaffected).

## Explicitly NOT touched

- `src/server/**` (code-gen pipeline, prompts, verifiers).
- `src/routes/builder*`, `src/components/CodeEditor`, `DevicePreviewFrame`, composer/generation UI internals.
- `src/routes/admin.*`, `src/routes/api/**`.
- Any Supabase migration, edge function, or backend logic.
- `src/routes/packs.*`, `templates.tsx`, `themes.tsx` (memory rule: internal-only, hidden from nav).
- Generated-app design system in `src/server/design-taste.server.ts` etc.

## Technical notes

- Add fonts in `__root.tsx` head via `<link>` (Tailwind v4 rule: no `@import` of remote URLs).
- New landing sections extracted into `src/components/landing/*.tsx` (≤120 lines each) so `index.tsx` stops growing past 1200 lines.
- Semantic tokens only in components; no raw color utilities.
- Unsplash images use `?w=…&q=80&auto=format` and `loading="lazy"`.
- No new npm deps. Uses existing `framer-motion` if present, otherwise CSS-only motion.
- Ship as one coherent batch, verified against build.

## Risks & mitigations

- Landing file size → split into components before editing.
- Font swap could affect generated apps if they import from `src/styles.css` — they don't (generated apps are separate projects), so safe.
- Auth split-screen could regress mobile — mobile-first layout, collapse below `md`.

Approve to proceed, or tell me which pages to drop/add.
