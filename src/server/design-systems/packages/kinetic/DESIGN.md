# Kinetic — playbook

Energy first. Syne (wide, expressive) for display at huge sizes, Plus Jakarta Sans for everything else. Colour comes in solid blocks, never gradients. The page should feel like it is moving even when it is still.

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `bg-primary text-primary-foreground`, `bg-foreground text-background` for inverted panels, `border-border`. Never a hex value or a raw palette utility.
- **Two faces, fixed roles.** `font-serif` (Syne) for headlines, big numbers and section labels; `font-sans` (Plus Jakarta Sans) for body, nav, buttons and forms.
- **One oversized moment per screen.** A headline at `text-6xl md:text-8xl`, a giant numeral, or a full-bleed colour panel.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif font-extrabold text-5xl md:text-8xl leading-[0.95] tracking-tighter uppercase` |
| Section heading | `font-serif font-bold text-4xl md:text-6xl tracking-tight` |
| Big number | `font-serif font-extrabold text-6xl md:text-7xl tabular-nums` |
| Body | `text-base md:text-lg leading-relaxed text-muted-foreground` |
| Label | `text-xs font-semibold uppercase tracking-[0.18em]` |

## Layout signatures

- Colour-block bands: alternate a `bg-primary text-primary-foreground` panel and a `bg-foreground text-background` panel with plain `bg-background` sections between them.
- Diagonal energy: offset images and cards with `-rotate-2` / `rotate-1`, overlap a sticker-style badge on a photo corner.
- Stats as headlines: numbers are big type, not small KPI cards.
- Full-bleed action photography with tight crops; people in motion over still products.

## Surface and shape

Cards `rounded-2xl border border-border bg-card`; buttons `rounded-full` with bold labels and generous padding (`h-12 px-7`). Shadows only on hover.

## Motion — quick and springy

150–250ms with the package ease (slight overshoot). Stagger lists, scale buttons on press (`active:scale-95`), slide panels in from the side. Respect `prefers-reduced-motion`.

## Never

Gradient text or meshes, pastel washes, thin hairline-only layouts, three equal icon cards, centred paragraphs longer than two lines, more than one accent hue on a screen.
