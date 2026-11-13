# Bloom — playbook

Warm, friendly and a little bit silly. Bricolage Grotesque (characterful, chunky at large sizes) for display, DM Sans for text. Cream page, white cards, a soft tint of the accent behind featured content, big curves.

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `bg-accent text-accent-foreground` for soft tinted panels, `bg-primary text-primary-foreground` for actions, `border-border`. Never hex or raw palette utilities.
- **Two faces, fixed roles.** `font-serif` (Bricolage Grotesque) for headlines, product names and prices; `font-sans` (DM Sans) for everything else.
- **Big friendly shapes.** Cards `rounded-3xl`, images `rounded-[2rem]`, buttons `rounded-full h-12 px-6`.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif font-extrabold text-5xl md:text-7xl leading-[1] tracking-tight` |
| Section heading | `font-serif font-bold text-3xl md:text-5xl tracking-tight` |
| Product name / price | `font-serif font-bold text-xl` |
| Body | `text-base md:text-lg leading-relaxed text-muted-foreground` |
| Label | `text-sm font-medium` (sentence case, never shouting caps) |

## Layout signatures

- Tinted feature panels: a `bg-accent rounded-[2.5rem] p-8 md:p-14` block holding the hero photo or a featured product, with the headline breaking out of it.
- Sticker details: small rotated pills (`-rotate-3`) such as "New", "Fresh today", "Fan favourite" overlapping image corners.
- Product grids with generous photos (`aspect-square rounded-3xl object-cover`), name and price below, an add button that pops on press.
- Wavy or blob-shaped image masks are fine for one hero image; everything else stays rectangular-rounded.

## Motion — bouncy, short

180–260ms with the package ease (gentle overshoot). Hover lifts `hover:-translate-y-1`, press squish `active:scale-95`, staggered entrance on grids. Respect `prefers-reduced-motion`.

## Never

Dark luxury palettes, thin hairline-only layouts, monospace, sharp square corners, gradient text, glassmorphism, corporate stock photography.
