# Meridian — playbook

Precise product studio (Linear / Stripe tier). Space Grotesk tight for display, Manrope for UI. Hairlines, not shadows. Numbers are typography.

## Type scale
| Role | Classes |
|---|---|
| Hero headline | `font-serif font-semibold text-5xl md:text-7xl leading-[1.02] tracking-tighter` |
| Section heading | `font-serif font-semibold text-3xl md:text-5xl tracking-tight` |
| Metric | `font-serif text-4xl md:text-5xl tabular-nums tracking-tight` |
| Label | `text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground` |
| Body | `text-[15px] leading-relaxed text-muted-foreground` |

## Layout signatures
- Product hero: headline left, a real app screen (built from components, not a picture) in a bordered frame right or below.
- Asymmetric bento: one 2×2 tile with live UI, three supporting tiles of different content types (metric, quote, mini-chart).
- App shells: 240px sidebar, 56px top bar, content `max-w-7xl`; tables with sticky headers and `tabular-nums`.
- Empty, loading (skeleton) and error states on every data view.

## Motion — surgical
120–200ms `ease-out`; position changes `cubic-bezier(0.22,1,0.36,1)`. `active:scale-[0.98]` on every button. No bounce.

## Never
Purple gradients, glassmorphism, glowing blobs, rounded-full buttons, centred three-card feature rows, decorative illustrations, hex values.

## Non-negotiable
Semantic tokens only (`bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`). Buttons are compact rectangles (`rounded-md`).
