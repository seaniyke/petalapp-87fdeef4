/**
 * Workstream C1 — hidden theme registry.
 *
 * Six named palette + typography pairings the Design Director picks ONE
 * of for every initial build. The chosen theme is translated into
 * concrete oklch tokens that the model writes into src/styles.css.
 *
 * The user never sees the theme name. To them it just feels like
 * "Petal nailed the look on turn one." Internally this dramatically
 * cuts the failure mode where every project converges on the same
 * Inter + indigo gradient SaaS look.
 *
 * Override path: if the user explicitly states brand colors, the
 * Design Director's `palette_mood` overrides these tokens — the theme
 * is a starting point, not a constraint.
 */

export type ThemeKey =
  | "editorial"
  | "saas-cool"
  | "warm-brand"
  | "brutalist"
  | "soft-pastel"
  | "mono-dark";

export interface ThemeSpec {
  /** Internal name. NEVER surfaced to the user. */
  key: ThemeKey;
  /** One-line internal description — shown only to the model. */
  description: string;
  /** Best-fit hint — drives picker scoring. */
  fitsWhen: string;
  display_font: string;
  body_font: string;
  /** Token values written verbatim into src/styles.css :root { … }. */
  tokens: {
    "--background": string;
    "--foreground": string;
    "--card": string;
    "--card-foreground": string;
    "--primary": string;
    "--primary-foreground": string;
    "--secondary": string;
    "--secondary-foreground": string;
    "--muted": string;
    "--muted-foreground": string;
    "--accent": string;
    "--accent-foreground": string;
    "--border": string;
    "--input": string;
    "--ring": string;
    "--radius": string;
  };
}

export const THEMES: Record<ThemeKey, ThemeSpec> = {
  editorial: {
    key: "editorial",
    description: "Magazine-grade serif headings, generous whitespace, ink-on-cream palette.",
    fitsWhen: "essays, blogs, portfolios, books, art, slow journalism, wineries",
    display_font: "Fraunces",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.98 0.012 80)",
      "--foreground": "oklch(0.18 0.01 60)",
      "--card": "oklch(0.99 0.008 80)",
      "--card-foreground": "oklch(0.18 0.01 60)",
      "--primary": "oklch(0.32 0.06 25)",
      "--primary-foreground": "oklch(0.98 0.012 80)",
      "--secondary": "oklch(0.94 0.018 80)",
      "--secondary-foreground": "oklch(0.22 0.01 60)",
      "--muted": "oklch(0.94 0.014 80)",
      "--muted-foreground": "oklch(0.45 0.012 60)",
      "--accent": "oklch(0.55 0.18 35)",
      "--accent-foreground": "oklch(0.98 0.012 80)",
      "--border": "oklch(0.88 0.014 80)",
      "--input": "oklch(0.92 0.014 80)",
      "--ring": "oklch(0.55 0.18 35)",
      "--radius": "0.4rem",
    },
  },
  "saas-cool": {
    key: "saas-cool",
    description: "Modern grotesque + cool slate palette with a confident indigo accent.",
    fitsWhen: "B2B SaaS, dev tools, productivity, dashboards, technical docs",
    display_font: "Space Grotesk",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.99 0.005 250)",
      "--foreground": "oklch(0.18 0.025 260)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.18 0.025 260)",
      "--primary": "oklch(0.55 0.2 265)",
      "--primary-foreground": "oklch(0.99 0.005 250)",
      "--secondary": "oklch(0.96 0.01 260)",
      "--secondary-foreground": "oklch(0.22 0.02 260)",
      "--muted": "oklch(0.96 0.01 260)",
      "--muted-foreground": "oklch(0.5 0.018 260)",
      "--accent": "oklch(0.6 0.18 200)",
      "--accent-foreground": "oklch(0.99 0.005 250)",
      "--border": "oklch(0.92 0.012 260)",
      "--input": "oklch(0.94 0.012 260)",
      "--ring": "oklch(0.55 0.2 265)",
      "--radius": "0.6rem",
    },
  },
  "warm-brand": {
    key: "warm-brand",
    description: "Warm cream + burnt sienna + deep ink. Hospitality, food, lifestyle brands.",
    fitsWhen: "restaurants, cafes, bakeries, lifestyle, hospitality, wellness, beauty",
    display_font: "Playfair Display",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.97 0.018 70)",
      "--foreground": "oklch(0.2 0.02 40)",
      "--card": "oklch(0.99 0.012 70)",
      "--card-foreground": "oklch(0.2 0.02 40)",
      "--primary": "oklch(0.5 0.16 40)",
      "--primary-foreground": "oklch(0.97 0.018 70)",
      "--secondary": "oklch(0.93 0.022 70)",
      "--secondary-foreground": "oklch(0.25 0.02 40)",
      "--muted": "oklch(0.93 0.018 70)",
      "--muted-foreground": "oklch(0.45 0.018 50)",
      "--accent": "oklch(0.6 0.13 145)",
      "--accent-foreground": "oklch(0.97 0.018 70)",
      "--border": "oklch(0.86 0.022 70)",
      "--input": "oklch(0.9 0.02 70)",
      "--ring": "oklch(0.5 0.16 40)",
      "--radius": "0.5rem",
    },
  },
  brutalist: {
    key: "brutalist",
    description: "High-contrast black/white, hard edges, monospace metadata, no rounded corners.",
    fitsWhen: "experimental, music, indie, design studios, clubs, zines",
    display_font: "Space Mono",
    body_font: "IBM Plex Sans",
    tokens: {
      "--background": "oklch(0.99 0 0)",
      "--foreground": "oklch(0.1 0 0)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.1 0 0)",
      "--primary": "oklch(0.1 0 0)",
      "--primary-foreground": "oklch(0.99 0 0)",
      "--secondary": "oklch(0.96 0 0)",
      "--secondary-foreground": "oklch(0.1 0 0)",
      "--muted": "oklch(0.94 0 0)",
      "--muted-foreground": "oklch(0.4 0 0)",
      "--accent": "oklch(0.7 0.22 60)",
      "--accent-foreground": "oklch(0.1 0 0)",
      "--border": "oklch(0.1 0 0)",
      "--input": "oklch(0.94 0 0)",
      "--ring": "oklch(0.1 0 0)",
      "--radius": "0rem",
    },
  },
  "soft-pastel": {
    key: "soft-pastel",
    description: "Friendly pastel palette, rounded shapes, playful but legible.",
    fitsWhen: "consumer apps for kids, education, wellbeing, journaling, habit trackers",
    display_font: "Bricolage Grotesque",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.99 0.006 320)",
      "--foreground": "oklch(0.22 0.04 300)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.22 0.04 300)",
      "--primary": "oklch(0.6 0.16 320)",
      "--primary-foreground": "oklch(0.99 0.006 320)",
      "--secondary": "oklch(0.95 0.022 200)",
      "--secondary-foreground": "oklch(0.25 0.04 300)",
      "--muted": "oklch(0.95 0.014 320)",
      "--muted-foreground": "oklch(0.5 0.022 300)",
      "--accent": "oklch(0.72 0.16 160)",
      "--accent-foreground": "oklch(0.18 0.04 300)",
      "--border": "oklch(0.9 0.018 320)",
      "--input": "oklch(0.93 0.014 320)",
      "--ring": "oklch(0.6 0.16 320)",
      "--radius": "1rem",
    },
  },
  "mono-dark": {
    key: "mono-dark",
    description: "Default-dark, near-mono palette with one electric accent. Cinematic, AI-native.",
    fitsWhen: "AI products, audio/video tools, gaming, crypto, founder-mode landing pages",
    display_font: "Unbounded",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.13 0.005 260)",
      "--foreground": "oklch(0.96 0.005 260)",
      "--card": "oklch(0.16 0.006 260)",
      "--card-foreground": "oklch(0.96 0.005 260)",
      "--primary": "oklch(0.78 0.18 145)",
      "--primary-foreground": "oklch(0.12 0.005 260)",
      "--secondary": "oklch(0.2 0.006 260)",
      "--secondary-foreground": "oklch(0.96 0.005 260)",
      "--muted": "oklch(0.2 0.006 260)",
      "--muted-foreground": "oklch(0.65 0.012 260)",
      "--accent": "oklch(0.78 0.18 145)",
      "--accent-foreground": "oklch(0.12 0.005 260)",
      "--border": "oklch(0.24 0.008 260)",
      "--input": "oklch(0.2 0.006 260)",
      "--ring": "oklch(0.78 0.18 145)",
      "--radius": "0.5rem",
    },
  },
};

/** Render the theme catalog so the Design Director can pick one. */
export function renderThemeCatalog(): string {
  const lines = Object.values(THEMES).map(
    (t) => `- "${t.key}" — ${t.description} (fits: ${t.fitsWhen}; type: ${t.display_font}/${t.body_font}).`,
  );
  return lines.join("\n");
}

/** Render the chosen theme's tokens as a copy-paste block for the builder model. */
export function renderThemeTokensBlock(key: ThemeKey): string {
  const t = THEMES[key];
  if (!t) return "";
  const tokenLines = Object.entries(t.tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return (
    `\n\n### Theme tokens (committed — write into src/styles.css under :root { … })\n` +
    `Do NOT pick different colors. These tokens encode the chosen vibe; reuse them via Tailwind semantic classes (bg-background, text-foreground, bg-primary, etc.). Add these EXACT values:\n\n` +
    `\`\`\`css\n:root {\n${tokenLines}\n}\n\`\`\`\n` +
    `Typography: load \`${t.display_font}\` (display) and \`${t.body_font}\` (body) from Google Fonts in index.html. Set --font-sans to "${t.body_font}", system-ui, sans-serif and create a display utility for "${t.display_font}".\n`
  );
}

/** Pick a theme from a brief using cheap keyword scoring. Best-effort. */
export function pickThemeForBrief(brief: string): ThemeKey {
  const b = brief.toLowerCase();
  const score: Record<ThemeKey, number> = {
    editorial: 0, "saas-cool": 0, "warm-brand": 0,
    brutalist: 0, "soft-pastel": 0, "mono-dark": 0,
  };
  const bumps: Array<[ThemeKey, RegExp[]]> = [
    ["editorial", [/blog|essay|magazine|journal|portfolio|writer|book|publication|newsletter|reader/]],
    ["saas-cool", [/saas|dashboard|admin|crm|api|developer|productivity|analytics|b2b|tool|workflow/]],
    ["warm-brand", [/restaurant|cafe|coffee|bakery|wine|hotel|spa|wellness|salon|beauty|food|menu|recipe/]],
    ["brutalist", [/music|club|festival|zine|indie|studio|gallery|underground|experimental/]],
    ["soft-pastel", [/kid|child|education|learn|habit|journal|wellness|meditation|cute|family|parenting/]],
    ["mono-dark", [/\bai\b|gpt|llm|crypto|web3|nft|gaming|audio|video|cinem|founder|launch/]],
  ];
  for (const [k, regs] of bumps) for (const r of regs) if (r.test(b)) score[k] += 2;
  let best: ThemeKey = "saas-cool";
  let bestScore = -1;
  for (const k of Object.keys(score) as ThemeKey[]) {
    if (score[k] > bestScore) { best = k; bestScore = score[k]; }
  }
  return best;
}
