# Substrate — playbook

Warm-neutral paper surfaces, a serif display face (Newsreader) against a clean grotesque (Geist), generous vertical rhythm, restrained elevation. The look is "considered editorial", not "startup template".

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `bg-primary text-primary-foreground`, `border-border`. Never a hex value, never `text-white`/`bg-black`, never `bg-blue-600`.
- **Two faces, fixed roles.** `font-serif` (Newsreader) for the hero headline, section headings and any pull-quote or story passage. `font-sans` (Geist) for everything else — nav, body, buttons, labels, tables, prices. Never a third family.
- **One primary action per view.** Everything else is `variant="outline"` or a plain link with an arrow.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight` |
| Section heading | `font-serif text-3xl md:text-4xl tracking-tight` |
| Sub-heading | `text-xl md:text-2xl` |
| Body | `text-base leading-relaxed text-muted-foreground` |
| Eyebrow / label | `text-xs uppercase tracking-[0.14em] text-muted-foreground` |

Section headings must not all be the same size. Vary between `text-3xl` and `text-5xl` down the page.

## Surface and elevation

- Page is `bg-background`. Alternate to `bg-muted` every two or three sections so the page has bands, not one flat sheet.
- Cards: `bg-card border border-border rounded-xl` with `shadow-sm`. Lift to `shadow-md` on hover only where the card is a link. Never nest a card inside a card.
- Elevation ladder is `shadow-sm` → `shadow-md` → `shadow-xl`, and `shadow-xl` is for overlays only.

## Rhythm

| Section type | Padding |
|---|---|
| Content-heavy | `py-16 md:py-24` |
| Final CTA | `py-16 md:py-20` |
| Logo / metric strip | `py-10 md:py-14` |
| Visual break | `py-8 md:py-12` |
| Footer | `py-12 md:py-16` |

Content width `max-w-6xl mx-auto px-6`; long-form prose narrows to `max-w-2xl`.

## Motion — surgical, locked

100–250ms, `ease-out` or `cubic-bezier(0.2,0,0.1,1)`. Animate `transform`, `opacity` and `filter` only. Hover lift is one consistent `hover:-translate-y-0.5`. Every pressable element gets `active:scale-[0.99]`. Never write `transition: all` in hand-authored CSS. Respect `prefers-reduced-motion`.

## Never

Gradient text. More than one accent hue on a screen. Three equal icon-cards as the answer to every section. Decorative blur blobs. Emoji as iconography. Centre-aligned body paragraphs longer than two lines.
