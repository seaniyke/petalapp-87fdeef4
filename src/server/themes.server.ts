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
  | "mono-dark"
  | "neo-brutalist"
  | "glass-morphism"
  | "terminal-green"
  | "sunset-gradient"
  | "nordic-minimal"
  | "cyberpunk-neon"
  | "paper-craft"
  | "luxury-gold"
  | "kids-playful"
  | "medical-clean"
  | "vibrant-gradient"
  | "y2k-bubble"
  | "earthy-organic"
  | "noir-mono"
  | "retro-arcade";

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
  "neo-brutalist": {
    key: "neo-brutalist",
    description: "Thick borders, hard drop shadows, saturated primary blocks, chunky typography.",
    fitsWhen: "indie products, founder landing pages, design portfolios, side projects, no-code tools",
    display_font: "Archivo Black",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.97 0.02 90)",
      "--foreground": "oklch(0.12 0 0)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.12 0 0)",
      "--primary": "oklch(0.7 0.22 30)",
      "--primary-foreground": "oklch(0.12 0 0)",
      "--secondary": "oklch(0.85 0.18 110)",
      "--secondary-foreground": "oklch(0.12 0 0)",
      "--muted": "oklch(0.94 0.01 90)",
      "--muted-foreground": "oklch(0.35 0 0)",
      "--accent": "oklch(0.7 0.2 230)",
      "--accent-foreground": "oklch(0.12 0 0)",
      "--border": "oklch(0.12 0 0)",
      "--input": "oklch(0.96 0.01 90)",
      "--ring": "oklch(0.12 0 0)",
      "--radius": "0.25rem",
    },
  },
  "glass-morphism": {
    key: "glass-morphism",
    description: "Frosted translucent surfaces over a soft gradient field, low-contrast dividers.",
    fitsWhen: "fintech, premium consumer apps, wallets, modern productivity, Apple-like aesthetics",
    display_font: "Geist",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.97 0.02 250)",
      "--foreground": "oklch(0.2 0.03 260)",
      "--card": "oklch(0.98 0.014 250)",
      "--card-foreground": "oklch(0.2 0.03 260)",
      "--primary": "oklch(0.6 0.18 280)",
      "--primary-foreground": "oklch(0.99 0.005 250)",
      "--secondary": "oklch(0.94 0.018 250)",
      "--secondary-foreground": "oklch(0.22 0.03 260)",
      "--muted": "oklch(0.94 0.018 250)",
      "--muted-foreground": "oklch(0.5 0.02 260)",
      "--accent": "oklch(0.7 0.16 200)",
      "--accent-foreground": "oklch(0.99 0.005 250)",
      "--border": "oklch(0.9 0.018 250)",
      "--input": "oklch(0.93 0.014 250)",
      "--ring": "oklch(0.6 0.18 280)",
      "--radius": "1.25rem",
    },
  },
  "terminal-green": {
    key: "terminal-green",
    description: "Pitch-black background, phosphor-green primary, monospace everything. Hacker vibe.",
    fitsWhen: "developer tools, CLIs, security, terminals, retro computing, hacker culture",
    display_font: "JetBrains Mono",
    body_font: "JetBrains Mono",
    tokens: {
      "--background": "oklch(0.1 0.005 150)",
      "--foreground": "oklch(0.9 0.18 145)",
      "--card": "oklch(0.13 0.008 150)",
      "--card-foreground": "oklch(0.9 0.18 145)",
      "--primary": "oklch(0.8 0.22 145)",
      "--primary-foreground": "oklch(0.1 0.005 150)",
      "--secondary": "oklch(0.18 0.01 150)",
      "--secondary-foreground": "oklch(0.9 0.18 145)",
      "--muted": "oklch(0.18 0.01 150)",
      "--muted-foreground": "oklch(0.6 0.12 145)",
      "--accent": "oklch(0.85 0.2 100)",
      "--accent-foreground": "oklch(0.1 0.005 150)",
      "--border": "oklch(0.25 0.04 145)",
      "--input": "oklch(0.18 0.01 150)",
      "--ring": "oklch(0.8 0.22 145)",
      "--radius": "0.125rem",
    },
  },
  "sunset-gradient": {
    key: "sunset-gradient",
    description: "Warm peach-to-magenta gradients on cream, vibrant CTAs, optimistic energy.",
    fitsWhen: "social, dating, creator economy, lifestyle, travel, summer brands, gen-z products",
    display_font: "Bricolage Grotesque",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.98 0.018 60)",
      "--foreground": "oklch(0.2 0.03 30)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.2 0.03 30)",
      "--primary": "oklch(0.65 0.22 25)",
      "--primary-foreground": "oklch(0.99 0.01 60)",
      "--secondary": "oklch(0.94 0.025 60)",
      "--secondary-foreground": "oklch(0.22 0.03 30)",
      "--muted": "oklch(0.95 0.018 60)",
      "--muted-foreground": "oklch(0.5 0.022 40)",
      "--accent": "oklch(0.65 0.22 350)",
      "--accent-foreground": "oklch(0.99 0.01 60)",
      "--border": "oklch(0.88 0.022 60)",
      "--input": "oklch(0.92 0.018 60)",
      "--ring": "oklch(0.65 0.22 25)",
      "--radius": "0.875rem",
    },
  },
  "nordic-minimal": {
    key: "nordic-minimal",
    description: "Cool whites, soft greys, single muted blue accent, Scandinavian restraint.",
    fitsWhen: "minimal SaaS, design tools, premium e-commerce, architecture, scandinavian brands",
    display_font: "Inter Tight",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.99 0.003 240)",
      "--foreground": "oklch(0.18 0.01 240)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.18 0.01 240)",
      "--primary": "oklch(0.45 0.08 230)",
      "--primary-foreground": "oklch(0.99 0.003 240)",
      "--secondary": "oklch(0.96 0.005 240)",
      "--secondary-foreground": "oklch(0.2 0.01 240)",
      "--muted": "oklch(0.96 0.005 240)",
      "--muted-foreground": "oklch(0.55 0.012 240)",
      "--accent": "oklch(0.7 0.06 220)",
      "--accent-foreground": "oklch(0.18 0.01 240)",
      "--border": "oklch(0.92 0.006 240)",
      "--input": "oklch(0.95 0.005 240)",
      "--ring": "oklch(0.45 0.08 230)",
      "--radius": "0.375rem",
    },
  },
  "cyberpunk-neon": {
    key: "cyberpunk-neon",
    description: "Deep purple-black with hot pink + cyan neon accents. Glow effects everywhere.",
    fitsWhen: "gaming, esports, web3, NFT, edgy AI, music apps, nightlife, streetwear",
    display_font: "Unbounded",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.12 0.04 290)",
      "--foreground": "oklch(0.96 0.02 320)",
      "--card": "oklch(0.16 0.05 290)",
      "--card-foreground": "oklch(0.96 0.02 320)",
      "--primary": "oklch(0.7 0.28 330)",
      "--primary-foreground": "oklch(0.1 0.04 290)",
      "--secondary": "oklch(0.2 0.06 290)",
      "--secondary-foreground": "oklch(0.96 0.02 320)",
      "--muted": "oklch(0.2 0.06 290)",
      "--muted-foreground": "oklch(0.7 0.06 320)",
      "--accent": "oklch(0.78 0.2 200)",
      "--accent-foreground": "oklch(0.1 0.04 290)",
      "--border": "oklch(0.28 0.08 290)",
      "--input": "oklch(0.2 0.06 290)",
      "--ring": "oklch(0.7 0.28 330)",
      "--radius": "0.5rem",
    },
  },
  "paper-craft": {
    key: "paper-craft",
    description: "Off-white textured paper feel, hand-drawn touches, warm brown ink, tactile.",
    fitsWhen: "stationery, journaling, recipes, crafts, kids storybooks, wedding, illustrators",
    display_font: "Caveat",
    body_font: "Lora",
    tokens: {
      "--background": "oklch(0.96 0.02 85)",
      "--foreground": "oklch(0.25 0.04 50)",
      "--card": "oklch(0.98 0.015 85)",
      "--card-foreground": "oklch(0.25 0.04 50)",
      "--primary": "oklch(0.4 0.1 50)",
      "--primary-foreground": "oklch(0.96 0.02 85)",
      "--secondary": "oklch(0.92 0.025 85)",
      "--secondary-foreground": "oklch(0.28 0.04 50)",
      "--muted": "oklch(0.92 0.02 85)",
      "--muted-foreground": "oklch(0.45 0.03 50)",
      "--accent": "oklch(0.65 0.16 65)",
      "--accent-foreground": "oklch(0.96 0.02 85)",
      "--border": "oklch(0.85 0.025 85)",
      "--input": "oklch(0.9 0.022 85)",
      "--ring": "oklch(0.4 0.1 50)",
      "--radius": "0.75rem",
    },
  },
  "luxury-gold": {
    key: "luxury-gold",
    description: "Deep charcoal background, antique-gold accents, elegant serif headings.",
    fitsWhen: "luxury fashion, jewelry, premium hospitality, private banking, watches, members clubs",
    display_font: "Cormorant Garamond",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.14 0.005 60)",
      "--foreground": "oklch(0.96 0.012 80)",
      "--card": "oklch(0.18 0.008 60)",
      "--card-foreground": "oklch(0.96 0.012 80)",
      "--primary": "oklch(0.78 0.13 85)",
      "--primary-foreground": "oklch(0.14 0.005 60)",
      "--secondary": "oklch(0.22 0.01 60)",
      "--secondary-foreground": "oklch(0.96 0.012 80)",
      "--muted": "oklch(0.22 0.01 60)",
      "--muted-foreground": "oklch(0.7 0.025 80)",
      "--accent": "oklch(0.78 0.13 85)",
      "--accent-foreground": "oklch(0.14 0.005 60)",
      "--border": "oklch(0.28 0.015 60)",
      "--input": "oklch(0.22 0.01 60)",
      "--ring": "oklch(0.78 0.13 85)",
      "--radius": "0.25rem",
    },
  },
  "kids-playful": {
    key: "kids-playful",
    description: "Bright primary palette, super-rounded shapes, big buttons, friendly bubbly type.",
    fitsWhen: "kids apps, toys, schools, summer camps, parenting, family games, learning for under-10s",
    display_font: "Fredoka",
    body_font: "Nunito",
    tokens: {
      "--background": "oklch(0.98 0.012 220)",
      "--foreground": "oklch(0.22 0.04 260)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.22 0.04 260)",
      "--primary": "oklch(0.7 0.22 30)",
      "--primary-foreground": "oklch(0.99 0.005 220)",
      "--secondary": "oklch(0.85 0.18 195)",
      "--secondary-foreground": "oklch(0.18 0.04 260)",
      "--muted": "oklch(0.95 0.014 220)",
      "--muted-foreground": "oklch(0.45 0.03 260)",
      "--accent": "oklch(0.78 0.2 145)",
      "--accent-foreground": "oklch(0.18 0.04 260)",
      "--border": "oklch(0.88 0.018 220)",
      "--input": "oklch(0.93 0.014 220)",
      "--ring": "oklch(0.7 0.22 30)",
      "--radius": "1.5rem",
    },
  },
  "medical-clean": {
    key: "medical-clean",
    description: "Crisp white, calming teal-blue primary, generous spacing, accessible contrast.",
    fitsWhen: "health, telemedicine, clinics, fitness, mental health, insurance, biotech, pharma",
    display_font: "DM Sans",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.99 0.005 200)",
      "--foreground": "oklch(0.18 0.02 220)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.18 0.02 220)",
      "--primary": "oklch(0.55 0.14 200)",
      "--primary-foreground": "oklch(0.99 0.005 200)",
      "--secondary": "oklch(0.95 0.012 200)",
      "--secondary-foreground": "oklch(0.2 0.02 220)",
      "--muted": "oklch(0.96 0.008 200)",
      "--muted-foreground": "oklch(0.5 0.015 220)",
      "--accent": "oklch(0.65 0.14 160)",
      "--accent-foreground": "oklch(0.99 0.005 200)",
      "--border": "oklch(0.91 0.012 200)",
      "--input": "oklch(0.94 0.01 200)",
      "--ring": "oklch(0.55 0.14 200)",
      "--radius": "0.625rem",
    },
  },
  "vibrant-gradient": {
    key: "vibrant-gradient",
    description: "Bold magenta→violet→cyan gradients on near-black, oversized display type, neon glow accents.",
    fitsWhen: "AI tools, creator tools, generative apps, music apps, modern consumer launches",
    display_font: "Bricolage Grotesque",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.12 0.03 280)",
      "--foreground": "oklch(0.97 0.01 280)",
      "--card": "oklch(0.16 0.04 285)",
      "--card-foreground": "oklch(0.97 0.01 280)",
      "--primary": "oklch(0.7 0.27 320)",
      "--primary-foreground": "oklch(0.12 0.03 280)",
      "--secondary": "oklch(0.22 0.05 285)",
      "--secondary-foreground": "oklch(0.97 0.01 280)",
      "--muted": "oklch(0.2 0.04 285)",
      "--muted-foreground": "oklch(0.7 0.04 280)",
      "--accent": "oklch(0.78 0.2 200)",
      "--accent-foreground": "oklch(0.12 0.03 280)",
      "--border": "oklch(0.28 0.05 285)",
      "--input": "oklch(0.22 0.04 285)",
      "--ring": "oklch(0.7 0.27 320)",
      "--radius": "1rem",
    },
  },
  "y2k-bubble": {
    key: "y2k-bubble",
    description: "Glossy bubble pinks + chrome silver, rounded everything, playful Y2K nostalgia.",
    fitsWhen: "gen-z social, dating, fashion, beauty, music fan sites, fun consumer apps",
    display_font: "Climate Crisis",
    body_font: "DM Sans",
    tokens: {
      "--background": "oklch(0.97 0.02 340)",
      "--foreground": "oklch(0.2 0.05 320)",
      "--card": "oklch(1 0 0)",
      "--card-foreground": "oklch(0.2 0.05 320)",
      "--primary": "oklch(0.72 0.22 350)",
      "--primary-foreground": "oklch(0.99 0.01 340)",
      "--secondary": "oklch(0.92 0.05 340)",
      "--secondary-foreground": "oklch(0.25 0.06 320)",
      "--muted": "oklch(0.94 0.03 340)",
      "--muted-foreground": "oklch(0.5 0.05 320)",
      "--accent": "oklch(0.78 0.16 250)",
      "--accent-foreground": "oklch(0.99 0.01 340)",
      "--border": "oklch(0.88 0.04 340)",
      "--input": "oklch(0.92 0.03 340)",
      "--ring": "oklch(0.72 0.22 350)",
      "--radius": "1.5rem",
    },
  },
  "earthy-organic": {
    key: "earthy-organic",
    description: "Warm sage, terracotta, sand, and bone palette with humanist serif headings.",
    fitsWhen: "wellness, skincare, sustainability, slow brands, herbal, yoga, plant shops",
    display_font: "Cormorant Garamond",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.96 0.02 75)",
      "--foreground": "oklch(0.22 0.03 50)",
      "--card": "oklch(0.98 0.015 75)",
      "--card-foreground": "oklch(0.22 0.03 50)",
      "--primary": "oklch(0.45 0.08 145)",
      "--primary-foreground": "oklch(0.97 0.02 75)",
      "--secondary": "oklch(0.9 0.03 75)",
      "--secondary-foreground": "oklch(0.25 0.03 50)",
      "--muted": "oklch(0.92 0.025 75)",
      "--muted-foreground": "oklch(0.45 0.03 60)",
      "--accent": "oklch(0.6 0.14 40)",
      "--accent-foreground": "oklch(0.97 0.02 75)",
      "--border": "oklch(0.86 0.025 75)",
      "--input": "oklch(0.9 0.025 75)",
      "--ring": "oklch(0.45 0.08 145)",
      "--radius": "0.5rem",
    },
  },
  "noir-mono": {
    key: "noir-mono",
    description: "Pure black + off-white, mono display type, single razor-thin red accent — editorial fashion noir.",
    fitsWhen: "fashion, photography, luxury streetwear, art galleries, agencies, film",
    display_font: "JetBrains Mono",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.08 0 0)",
      "--foreground": "oklch(0.96 0 0)",
      "--card": "oklch(0.12 0 0)",
      "--card-foreground": "oklch(0.96 0 0)",
      "--primary": "oklch(0.96 0 0)",
      "--primary-foreground": "oklch(0.08 0 0)",
      "--secondary": "oklch(0.18 0 0)",
      "--secondary-foreground": "oklch(0.96 0 0)",
      "--muted": "oklch(0.16 0 0)",
      "--muted-foreground": "oklch(0.65 0 0)",
      "--accent": "oklch(0.6 0.22 27)",
      "--accent-foreground": "oklch(0.96 0 0)",
      "--border": "oklch(0.22 0 0)",
      "--input": "oklch(0.18 0 0)",
      "--ring": "oklch(0.6 0.22 27)",
      "--radius": "0rem",
    },
  },
  "retro-arcade": {
    key: "retro-arcade",
    description: "Pixel-grid dark with electric purple + lime + hot-pink CRT accents, pixel display font.",
    fitsWhen: "gaming, esports, retro tech, indie games, hackathons, dev portfolios",
    display_font: "Press Start 2P",
    body_font: "Inter",
    tokens: {
      "--background": "oklch(0.14 0.04 280)",
      "--foreground": "oklch(0.95 0.02 280)",
      "--card": "oklch(0.18 0.05 280)",
      "--card-foreground": "oklch(0.95 0.02 280)",
      "--primary": "oklch(0.78 0.24 140)",
      "--primary-foreground": "oklch(0.14 0.04 280)",
      "--secondary": "oklch(0.24 0.06 290)",
      "--secondary-foreground": "oklch(0.95 0.02 280)",
      "--muted": "oklch(0.22 0.05 285)",
      "--muted-foreground": "oklch(0.7 0.04 280)",
      "--accent": "oklch(0.7 0.26 340)",
      "--accent-foreground": "oklch(0.14 0.04 280)",
      "--border": "oklch(0.3 0.06 285)",
      "--input": "oklch(0.22 0.05 285)",
      "--ring": "oklch(0.78 0.24 140)",
      "--radius": "0.25rem",
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
    "neo-brutalist": 0, "glass-morphism": 0, "terminal-green": 0,
    "sunset-gradient": 0, "nordic-minimal": 0, "cyberpunk-neon": 0,
    "paper-craft": 0, "luxury-gold": 0, "kids-playful": 0, "medical-clean": 0,
  };
  const bumps: Array<[ThemeKey, RegExp[]]> = [
    ["editorial", [/blog|essay|magazine|journal|portfolio|writer|book|publication|newsletter|reader/]],
    ["saas-cool", [/saas|dashboard|admin|crm|api|developer|productivity|analytics|b2b|tool|workflow/]],
    ["warm-brand", [/restaurant|cafe|coffee|bakery|wine|hotel|spa|salon|beauty|food|menu|recipe|boutique|merch|apparel|clothing|shoes|jewelry shop|gift shop|store|shop|ecommerce|e-commerce|storefront/]],
    ["brutalist", [/music|club|festival|zine|gallery|underground|experimental/]],
    ["soft-pastel", [/journaling|meditation|cute|gentle|calm|breathe|mindful/]],
    ["mono-dark", [/\bai\b|gpt|llm|crypto|web3|nft|audio|video|cinem|founder|launch/]],
    ["neo-brutalist", [/indie|side project|maker|no-code|nocode|product hunt|launch page|founder/]],
    ["glass-morphism", [/wallet|fintech|finance|banking|premium|apple|ios|sleek/]],
    ["terminal-green", [/cli|terminal|hacker|developer tool|devtool|security|infosec|sysadmin|ssh/]],
    ["sunset-gradient", [/dating|social|creator|influencer|lifestyle|travel|summer|gen.?z|tiktok/]],
    ["nordic-minimal", [/minimal|scandinavi|nordic|architecture|interior|premium ecommerce|design tool/]],
    ["cyberpunk-neon", [/gaming|esports|web3|nft|streetwear|nightlife|club night|edgy|neon/]],
    ["paper-craft", [/stationery|recipe|crafts|storybook|wedding|illustrator|knitting|scrapbook/]],
    ["luxury-gold", [/luxury|jewelry|watch|fashion house|private bank|members club|hospitality|atelier/]],
    ["kids-playful", [/kid|child|toddler|toy|school|camp|family|learning game|under.?\d/]],
    ["medical-clean", [/health|medical|clinic|telemedicine|telehealth|fitness|mental health|insurance|biotech|pharma|patient|wellness/]],
  ];
  for (const [k, regs] of bumps) for (const r of regs) if (r.test(b)) score[k] += 2;
  let best: ThemeKey = "saas-cool";
  let bestScore = -1;
  for (const k of Object.keys(score) as ThemeKey[]) {
    if (score[k] > bestScore) { best = k; bestScore = score[k]; }
  }
  return best;
}
