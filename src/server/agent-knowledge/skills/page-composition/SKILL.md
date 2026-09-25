---
name: page-composition
description: How sections sequence and vary across a whole page — order, rhythm, and the anti-monotony rules.
preload: true
---

A page is a sequence, not a stack of blocks. These rules govern the page as a whole. Where a `section-architectures` skill is listed as available, it covers the shape of the individual sections; these rules still apply either way.

## Order

Multi-section marketing pages answer the visitor's questions in this order. Skip any section the site doesn't need — never reorder the ones you keep.

**Hero → WHAT it does → PROOF others use it → HOW it works → RESULTS → PRICING → REMAINING OBJECTIONS → FINAL CTA → FOOTER**

The final CTA is its own section. The footer is not a CTA.

**Scope.** These are rules for a page you are building or restructuring as a whole. When the user asks for a single new section on an existing page, apply them only to the section you are adding, and do not restyle or rewrite the surrounding ones.

Two different things are being asked of that new section, and they are not in conflict: its **design vocabulary** must match the page (same palette, type family, spacing scale, component styling), while its **layout shape** should differ from its immediate neighbours (heading scale, background tone, column structure). Consistent materials, varied form.

## Rhythm — the anti-monotony rules

A page where every section is the same shape reads as a wall, however good each section is on its own. Apply all five:

1. **Never three grid sections in a row.** Two consecutive grid-based sections is the maximum. Break the run with a split layout, a full-width band, or a single centered statement.
2. **Adjacent sections must not share a layout direction.** If one section is content-left/visual-right, the next must not repeat it. Alternate, center, or go full-width.
3. **Vary heading scale between sections.** If every section heading is `text-4xl`, the page has no dynamics. Move between `text-3xl` and `text-5xl` deliberately — a quiet section before a loud one makes the loud one land.
4. **Alternate background tone every two to three sections.** `bg-background` → `bg-muted` → `bg-background`. Never five sections on an identical background.
5. **One visual break per long page.** A full-bleed image, one large statistic, or a marquee strip — a section that isn't another content block.

## Vertical rhythm

Not every section deserves the same padding. Uniform padding is what makes a page feel machine-generated.

| Section kind | Padding |
|---|---|
| Content-heavy (features, pricing, FAQ) | `py-16 md:py-24` |
| Final CTA banner | `py-16 md:py-20` |
| Logo / proof strip | `py-10 md:py-14` |
| Visual break | `py-8 md:py-12` or none |
| Footer | `py-12 md:py-16` |

## CTAs

Two, maybe three across the entire page: one in the hero, one at the end, optionally one mid-page. A CTA in every section reads as desperation and trains the visitor to ignore all of them.

## Sections belong to the page

Every section continues what the hero established — same palette, same type scale, same component vocabulary. A section that could be dropped into any other site unchanged is a generic section. If the hero is restrained, a loud section below it looks like a different site, not a highlight.
