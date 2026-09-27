# Obsidian — playbook

Dark-first editorial luxury. Near-black surfaces, a high-contrast serif display (Instrument Serif) against a geometric sans (Plus Jakarta Sans), hairline rules instead of shadows, almost no colour. Restraint is the entire look.

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`. Never a hex value, never `text-white`.
- **Separation by hairline, not by shadow.** `border-t border-border` between sections and around cards. `shadow-md` only for overlays.
- **Colour is an event.** At most one accent moment per screen — usually the single primary button. Everything else is neutral.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif text-5xl md:text-7xl leading-[1.02]` |
| Section heading | `font-serif text-3xl md:text-5xl` |
| Eyebrow / label | `text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground` |
| Body | `text-base leading-relaxed text-muted-foreground max-w-2xl` |

Wide letter-spaced uppercase labels are the signature. Use them for section eyebrows, nav, and metric captions.

## Rhythm

Sections breathe: `py-24 md:py-32` for feature sections, `py-16 md:py-20` for strips, `py-16` for the footer. Content width `max-w-6xl mx-auto px-6`. Asymmetry is welcome — a 5/7 split reads more designed than a 6/6.

## Imagery

Full-bleed, high-contrast, `object-cover` with an explicit aspect ratio. Text over an image always sits on a scrim (`bg-gradient-to-t from-background`). Grayscale on rest, colour on hover is a valid treatment; pick one and use it everywhere.

## Motion — cinematic, locked

500–800ms `cubic-bezier(0.16,1,0.3,1)` for reveals; 200ms `ease-out` for hovers. Animate `transform`, `opacity`, `filter` only. Same translate distance for every scroll reveal. Respect `prefers-reduced-motion`.

## Never

Rounded-full buttons. Bright saturated fills. Gradient text. Drop shadows on cards. Three equal icon-cards. More than one accent hue on a screen.
