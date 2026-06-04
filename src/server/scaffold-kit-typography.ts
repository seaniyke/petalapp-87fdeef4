/**
 * Phase 14 — Typography system reference.
 *
 * The actual styling tokens (fluid type scale + font tokens + Fontsource
 * imports) live in scaffold-kit.ts's STYLES_CSS. This module ships the
 * `FONTS.md` reference doc so the design director and the model have a
 * single place to look up how to swap typefaces per theme.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

const FONTS_DOC = `# Typography — Petal house rules

The scaffold ships a self-hosted, variable-font typography system. **Do not
use Google Fonts \`<link>\` tags** — they cause CLS, leak IP to Google, and
add a network hop. Use Fontsource Variable packages instead.

## Defaults (already wired in src/styles.css)

| Token              | Default                  | Purpose                              |
|--------------------|--------------------------|--------------------------------------|
| \`--font-sans\`     | Inter Variable           | body, UI                             |
| \`--font-display\`  | (inherits sans)          | headings — override per theme        |
| \`--font-serif\`    | system serif stack       | editorial body / pull-quotes         |
| \`--font-mono\`     | JetBrains Mono Variable  | code, KBD, ticker numerals           |

Helper classes are pre-wired:
- \`.font-display\` → \`--font-display\` + tightest tracking (use on h1/h2)
- \`.font-serif\`  → \`--font-serif\`
- \`.font-mono\`   → \`--font-mono\`

## Fluid type scale (Utopia clamp)

Every step scales smoothly from 320px → 1280px viewport. Use these instead
of fixed Tailwind \`text-*\` sizes for any type that needs to breathe.

| Class            | Range            | Typical use                  |
|------------------|------------------|------------------------------|
| \`text-step--1\`  | 12 → 14 px       | captions, small print        |
| \`text-step-0\`   | 16 → 18 px       | body (default on \`<body>\`)  |
| \`text-step-1\`   | 18 → 22 px       | lead paragraph               |
| \`text-step-2\`   | 22 → 28 px       | h4                           |
| \`text-step-3\`   | 26 → 36 px       | h3                           |
| \`text-step-4\`   | 32 → 48 px       | h2                           |
| \`text-step-5\`   | 40 → 64 px       | h1                           |
| \`text-step-6\`   | 48 → 88 px       | hero / display               |

\`\`\`tsx
<h1 className="font-display text-step-6">Quiet luxury.</h1>
<p className="text-step-1 text-muted-foreground">A lead paragraph.</p>
<small className="text-step--1 uppercase tracking-widest">Caption</small>
\`\`\`

## Swapping fonts per theme

Pick a Fontsource Variable package from the catalog below, \`@import\` it at
the TOP of src/styles.css (above other imports), then override the token
in \`@theme\`.

\`\`\`css
@import "tailwindcss";
@import "@fontsource-variable/inter";
@import "@fontsource-variable/instrument-serif"; /* editorial display */
@import "@fontsource-variable/jetbrains-mono";

@theme {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui;
  --font-display: "Instrument Serif Variable", ui-serif, Georgia, serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace;
}
\`\`\`

### Catalog (all installed on-demand via known-packages)

- **Modern tech / SaaS** — \`space-grotesk\` + \`dm-sans\`, \`outfit\` + \`figtree\`, \`sora\` + \`manrope\`
- **Creative startups** — \`syne\` + \`plus-jakarta-sans\`, \`bricolage-grotesque\` + \`dm-sans\`
- **Editorial / publishing** — \`instrument-serif\` + \`work-sans\`, \`dm-serif-display\` + \`fira-sans\`
- **Luxury / fashion** — \`cormorant\` + \`karla\`, \`playfair-display\` + \`manrope\`
- **Finance / legal** — \`libre-baskerville\` + \`ibm-plex-sans\`
- **Blog / longform** — \`lora\` + \`nunito-sans\`
- **Architecture / real estate** — \`urbanist\` + \`epilogue\`
- **News / activism** — \`archivo-black\` + \`hind\` (non-variable for archivo)
- **Sports / events** — \`bebas-neue\` + \`barlow\` (non-variable for bebas)
- **Creative portfolio** — \`abril-fatface\` + \`cabin\` (non-variable for abril)
- **Tech docs / APIs** — \`jetbrains-mono\` + \`work-sans\`
- **Indie tech / gaming** — \`space-mono\` + \`rubik\` (non-variable for mono)

## Why variable fonts

One file per family, every weight/width/optical-size axis. Smaller payload,
buttery weight transitions in motion components (\`SplitText\` with weight
ease-in works great on variable axes).

## A11y

- Body line-height ≥ 1.5 (defaults satisfy this).
- Body font-size ≥ 16px at the smallest viewport (\`text-step-0\` starts at 1rem).
- Maintain 4.5:1 contrast — semantic tokens already do this in both themes.
`;

export const KIT_TYPOGRAPHY_FILES: KitFile[] = [
  { path: "src/components/examples/FONTS.md", content: FONTS_DOC, overwrite: true },
];
