# Landing page redesign + differentiator pages

Two things: rebuild the landing page so it reads as designed-by-a-human, and give Petal's real differentiators (marketplace, pay-as-you-build, agent board, own-your-code) headline space plus their own sub-pages.

Since the taste questions were skipped, these are the locked choices:

- **Palette** — keep Petal's warm paper + terracotta coral, pushed to higher contrast (near-black ink `#0d0d0d` instead of soft grey, coral reserved for accents only). No new hues, no purple/indigo gradient.
- **Type** — keep Fraunces as the display face but use it the way the reference posts do: oversized, tight tracking, italic for the emotional line. Body stays the current sans. Add the italic axis to the font link.
- **Layout** — editorial/magazine. One oversized statement per screen, asymmetric grids, generous whitespace, no wall of identical feature cards.

## Anti-slop rules applied to the page

The reference posts are design-intelligence packs; the rules they encode become hard constraints for this rebuild:

1. No three-equal-cards-in-a-row grid. Every grid is asymmetric or mixed-size.
2. No icon-in-a-rounded-square repeated twelve times. Icons appear at most in one section.
3. Type scale does the work: hero headline jumps to a genuinely large size with negative tracking; supporting copy stays small. No mid-sized mush.
4. Motion has a register: one entrance behaviour (short, eased, staggered), used consistently; nothing bounces, nothing loops forever, everything respects reduced-motion.
5. Real numbers and real product surfaces only — no invented testimonials, no "trusted by" logo wall of companies that never used Petal.
6. Coral is an accent, not a background. At most two coral elements per viewport.

## Landing page structure

```text
nav
hero            oversized editorial headline + single primary CTA + live prompt field
proof strip     real counts (projects built, listings, credits model) — no fake logos
THE DIFFERENCE  4 differentiators, asymmetric magazine grid, each links to its page
whole stack     existing WholeStackSection, restyled to the new scale
how it works    3 steps, numbered editorially, not as cards
marketplace     dedicated band: browse listings + sell your build
pricing teaser  pay-as-you-build framing, credits not subscriptions
faq
final CTA
footer
```

## The four differentiator sub-pages

New route file `src/routes/why.$slug.tsx`, following the existing `features.$slug.tsx` pattern (typed record of entries, per-slug `head()` metadata, prev/next navigation). Slugs:

| Slug | Page |
| --- | --- |
| `marketplace` | Buy and sell finished software. How listings, licences, transfer and the 20% fee work. |
| `pay-as-you-build` | Credits you buy once, never expire, no mandatory subscription. Contrast with seat-based plans. |
| `agent-board` | The specialist agents (product, architecture, design, security, QA) that review each build before code is written. |
| `own-your-code` | Real React in your repo, Git sync, export, deploy to your own domain. |

Each page: editorial hero, three substance blocks, one honest proof row, CTA into the product. Each gets its own `head()` with unique title, description, `og:title`, `og:description`.

Landing links into all four; a compact cross-link rail sits at the foot of each sub-page.

## Generated apps (second pass, same round)

Roll the same six anti-slop rules into the design agent's contract so generated apps inherit them: forbid symmetric card triplets as the default section shape, require one committed motion register, require a real type-scale jump, cap accent-colour usage. This edits the design director / design finisher instruction text only — no pipeline restructuring.

## Technical notes

- `src/routes/index.tsx` is rebuilt section by section; shared chrome (`SiteHeader`, footer) is reused unchanged.
- New tokens for the tightened ink and editorial spacing go in `src/styles.css` as semantic variables — no hard-coded hex in components.
- Font link in `src/routes/__root.tsx` gains the Fraunces italic axis.
- New route `src/routes/why.$slug.tsx`; route tree regenerates automatically.
- No backend, billing, or marketplace logic changes — presentation only, apart from the design-agent instruction text.

## Out of scope

Pricing changes, marketplace mechanics, auth, and the builder UI stay as they are.
