# Obsidian — playbook

Dark-first editorial luxury. Near-black surfaces, a high-contrast serif display (Instrument Serif) against a geometric sans (Plus Jakarta Sans), soft layered depth, almost no colour. Calm, warm and spacious — luxury, never a terminal.

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`. Never a hex value, never `text-white`.
- **Layered depth, not boxes.** Soft rounded surfaces (`rounded-2xl`/`rounded-3xl`), `glass` panels over imagery, `edge-light` on dark cards, one `mesh-backdrop` or `ambient-glow` behind the hero. Hairlines only where a quiet divider helps.
- **Colour is an event.** At most one accent moment per screen — usually the single primary button. Everything else is neutral.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif text-5xl md:text-7xl leading-[1.02]` |
| Section heading | `font-serif text-3xl md:text-5xl` |
| Eyebrow / label | `text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground` |
| Body | `text-base leading-relaxed text-muted-foreground max-w-2xl` |

Use small uppercase eyebrows sparingly (one per section at most), in plain words — never codes, numbering like `01 //`, or monospace spec labels.

## Rhythm

Sections breathe: `py-24 md:py-32` for feature sections, `py-16 md:py-20` for strips, `py-16` for the footer. Content width `max-w-6xl mx-auto px-6`. Asymmetry is welcome — a 5/7 split reads more designed than a 6/6.

## Imagery

Full-bleed, high-contrast, `object-cover` with an explicit aspect ratio. Text over an image always sits on a scrim (`bg-gradient-to-t from-background`). Grayscale on rest, colour on hover is a valid treatment; pick one and use it everywhere.

## Motion — cinematic, locked

500–800ms `cubic-bezier(0.16,1,0.3,1)` for reveals; 200ms `ease-out` for hovers. Animate `transform`, `opacity`, `filter` only. Same translate distance for every scroll reveal. Respect `prefers-reduced-motion`.

## Never

Developer/console tropes on consumer sites (`01 //`, `SRV-01`, coordinates, monospace spec sheets, 'protocol'/'dispatch' wording). Harsh red warning banners for policies. Bright saturated fills. Three equal icon-cards. More than one accent hue on a screen.
