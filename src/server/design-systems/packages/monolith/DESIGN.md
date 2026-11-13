# Monolith — playbook

Swiss and architectural. Archivo Black for display (it has one heavy weight), Archivo for text. A visible 12-column grid, square corners everywhere, 1px rules instead of shadows, and one signal colour used sparingly.

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`. Never hex or raw palette utilities.
- **Square corners.** Every radius token is zero — do not add `rounded-*` classes (except `rounded-full` on avatars).
- **Rules, not shadows.** Separate content with `border-t border-border` / `divide-y divide-border`. No drop shadows on cards.
- **Two faces, fixed roles.** `font-serif` (Archivo Black) for headlines and big index numbers; `font-sans` (Archivo) for everything else.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif text-5xl md:text-8xl leading-[0.92] tracking-tight uppercase` |
| Section heading | `font-serif text-3xl md:text-5xl tracking-tight uppercase` |
| Index number | `font-serif text-sm tabular-nums` (01, 02, 03 before each section title) |
| Body | `text-base leading-relaxed text-muted-foreground max-w-prose` |
| Label | `text-[11px] font-semibold uppercase tracking-[0.2em]` |

## Layout signatures

- Asymmetric 12-column grid: label column `md:col-span-3`, content `md:col-span-9`; headline spans, body does not.
- Numbered sections (01 / 02 / 03) with a full-width top rule and the title flush left.
- Tabular lists instead of cards: projects, services or prices as rows with columns, separated by hairlines.
- Large black-and-white or duotone photography cropped hard to the grid; captions in small caps under each image.

## Motion — precise

120–180ms, standard ease. Underline wipes on links, row highlight on hover (`hover:bg-muted`). No bounce, no parallax.

## Never

Rounded cards, drop shadows, gradients, pastel colours, emoji, centred layouts, icon-in-circle feature grids, more than one accent hue.
