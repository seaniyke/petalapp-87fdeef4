# Brutalist — playbook

Engineered and raw. JetBrains Mono for headlines, labels, numbers and code; Work Sans for reading text. Thick borders, hard offset shadows, visible structure. It should look built, not decorated.

## Non-negotiable

- **Semantic tokens only.** `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary text-primary-foreground`. Never hex or raw palette utilities.
- **Borders carry the design.** Cards, inputs and buttons use `border-2 border-foreground` (or `border-border`). Elevation is the hard offset `shadow-[var(--kimble-shadow-md)]`, never a blur shadow.
- **Two faces, fixed roles.** `font-serif` (JetBrains Mono) for headlines, labels, metadata, prices and code. `font-sans` (Work Sans) for paragraphs.

## Type scale

| Role | Classes |
|---|---|
| Hero headline | `font-serif font-extrabold text-4xl md:text-7xl leading-none tracking-tight` |
| Section heading | `font-serif font-bold text-2xl md:text-4xl` with a `// ` or `[01]` prefix |
| Metadata | `font-serif text-xs uppercase tracking-wider text-muted-foreground` |
| Body | `text-base leading-relaxed` |
| Code | `font-serif text-sm bg-muted border border-border px-1.5` |

## Layout signatures

- Visible grid: sections boxed by `border-2` with shared edges (`-ml-0.5 -mt-0.5`) so cells butt together like a spreadsheet.
- Terminal-style hero: a command, a blinking cursor, or a real code/API snippet next to the headline.
- Spec tables and changelog lists instead of feature cards; status chips in mono uppercase.
- Buttons: `rounded-sm border-2 border-foreground` with the hard shadow; on press translate into the shadow (`active:translate-x-0.5 active:translate-y-0.5 active:shadow-none`).

## Motion — mechanical

Short (80–150ms) and stepped. Cursor blink, typewriter reveal on one headline, instant hover inversions (`hover:bg-foreground hover:text-background`). Respect `prefers-reduced-motion`.

## Never

Soft blur shadows, gradients, glassmorphism, rounded-2xl cards, pastel palettes, stock photos of people at laptops, more than one accent hue.
