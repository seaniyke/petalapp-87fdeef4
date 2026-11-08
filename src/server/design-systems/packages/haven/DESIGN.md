# Haven — playbook

Calm care studio. Sora for display, Nunito Sans for body at a generous size. Everything says: you are in good hands.

## Type scale
| Role | Classes |
|---|---|
| Hero headline | `font-serif font-medium text-4xl md:text-6xl leading-[1.08] tracking-tight` |
| Section heading | `font-serif font-medium text-3xl md:text-4xl` |
| Label | `text-xs font-semibold uppercase tracking-[0.16em] text-primary` |
| Body | `text-base md:text-lg leading-relaxed text-muted-foreground max-w-prose` (never below 16px) |

## Layout signatures
- Hero split: reassuring headline + one clear booking action left, warm human photograph (`aspect-[4/3]`, `rounded-lg`) right.
- Services as large tappable rows or a 2-column list with short plain-language descriptions.
- Practitioner cards: portrait, name, role, one line — whole card links.
- Trust strip: opening hours, address, phone, accreditations in plain text.
- App screens: generous row height, clear status badges via semantic tokens, confirmations before destructive actions.

## Motion — gentle
200–300ms `cubic-bezier(0.2,0,0,1)`, fades and 8px rises only. Respect `prefers-reduced-motion`.

## Never
Medical stock clichés (stethoscope close-ups), red as decoration, dense jargon, tiny grey text, pills for buttons, hex values.

## Non-negotiable
Semantic tokens only (`bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`). Buttons are compact rectangles (`rounded-md`).
