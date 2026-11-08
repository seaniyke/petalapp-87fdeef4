# Atelier — playbook

Warm editorial studio. Linen paper tones, Fraunces at light weight for display, Figtree for everything else. The photograph is the hero; type frames it.

## Type scale
| Role | Classes |
|---|---|
| Hero headline | `font-serif font-light text-5xl md:text-7xl lg:text-8xl leading-[1.02] tracking-tight` |
| Section heading | `font-serif text-3xl md:text-5xl leading-[1.08]` |
| Eyebrow | `text-xs uppercase tracking-[0.2em] text-muted-foreground` |
| Body | `text-base md:text-lg leading-relaxed text-muted-foreground max-w-prose` |

## Layout signatures
- Asymmetric split heroes (7/5) with a tall portrait photograph `aspect-[4/5]` and text set low.
- Services as an editorial list (name · duration · price on hairline rows), never icon cards.
- One full-bleed atmosphere photograph band per page, with a short quote on a scrim.
- Galleries as uneven masonry (mix `aspect-[3/4]` and `aspect-[4/3]`).

## Rhythm
`py-24 md:py-36` for sections, `max-w-6xl mx-auto px-6`. White space is the luxury; never fill it.

## Motion — physical
Reveals 600ms `cubic-bezier(0.16,1,0.3,1)`, 16px rise + fade, 80ms stagger. Image hover `scale-[1.03]` over 900ms. Respect `prefers-reduced-motion`.

## Never
Pills, gradients, drop-shadowed cards, bright saturated fills, icon grids, more than one accent moment per screen, hex values.

## Non-negotiable
Semantic tokens only (`bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`). Buttons are compact rectangles (`rounded-md`).
