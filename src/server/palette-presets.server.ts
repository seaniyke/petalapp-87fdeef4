/**
 * Curated palette + typography presets.
 *
 * The model, left alone, defaults to indigo-on-white with Inter. We give
 * it a locked palette + font pair chosen for the project archetype so
 * every landing stops rhyming with the last. These strings are injected
 * verbatim into the system prompt (see `design-taste.server.ts`).
 *
 * Presets are lifted from Lovable's own `questions_design_preferences`
 * catalog so Petal's taste vocabulary matches the ecosystem.
 */

export interface PalettePreset {
  id: string;
  label: string;
  /** 4 hex values: bg-deep, bg-surface, accent, accent-soft. */
  colors: [string, string, string, string];
  /** One-line vibe used in prompt copy. */
  vibe: string;
  /** Archetype tags the picker uses for matching. */
  tags: string[];
}

export interface FontPairPreset {
  id: string;
  label: string;
  display: string;
  body: string;
  tags: string[];
}

export const PALETTES: PalettePreset[] = [
  { id: "midnight-indigo", label: "Midnight Indigo", colors: ["#0a0a1a", "#141432", "#4f46e5", "#818cf8"], vibe: "sophisticated tech, deep navy stage lit by electric indigo", tags: ["saas", "developer", "ai", "fintech"] },
  { id: "charcoal-ember", label: "Charcoal & Ember", colors: ["#1a1a1a", "#2d2d2d", "#e85d3a", "#f5a582"], vibe: "premium, warm ember on charcoal", tags: ["agency", "portfolio", "creative", "studio"] },
  { id: "noir-gold", label: "Noir & Gold", colors: ["#0d0d0d", "#1a1a1a", "#c9a84c", "#f0d78c"], vibe: "high-end editorial, black with luxurious gold", tags: ["luxury", "editorial", "restaurant", "hospitality"] },
  { id: "cloud-white", label: "Cloud White", colors: ["#fafbfc", "#e8ecf1", "#3b82f6", "#93c5fd"], vibe: "airy SaaS, crisp whites and cool blue accent", tags: ["saas", "productivity", "b2b"] },
  { id: "warm-sand", label: "Warm Sand", colors: ["#faf8f5", "#f0ebe3", "#c9b99a", "#8b7355"], vibe: "welcoming, sandy neutrals", tags: ["wellness", "hospitality", "lifestyle", "food"] },
  { id: "paper-ink", label: "Paper & Ink", colors: ["#f5f3ee", "#e8e4dd", "#2d2d2d", "#0d0d0d"], vibe: "Swiss editorial, off-white and rich black", tags: ["editorial", "portfolio", "writer", "consultancy"] },
  { id: "terracotta-sage", label: "Terracotta & Sage", colors: ["#c4654a", "#e8a87c", "#87a878", "#4a6741"], vibe: "earthy, terracotta grounded by sage", tags: ["wellness", "artisan", "farm", "handmade"] },
  { id: "ocean-deep", label: "Ocean Deep", colors: ["#0c2340", "#1a4a6e", "#2d8a9e", "#5cbdb9"], vibe: "calm, trustworthy, professional blues", tags: ["fintech", "healthcare", "law", "consultancy"] },
  { id: "arctic-frost", label: "Arctic Frost", colors: ["#e8f0f8", "#b8d4e8", "#6ba3c8", "#2e6b8a"], vibe: "crisp, pristine icy blues", tags: ["saas", "productivity", "clinical"] },
  { id: "electric-coral", label: "Electric Coral", colors: ["#ff6b6b", "#ee5a70", "#c44569", "#574b90"], vibe: "energetic, vivid coral and hot pink", tags: ["consumer", "social", "creator", "events"] },
  { id: "neon-mint", label: "Neon Mint", colors: ["#0d1b2a", "#1b4332", "#2dd4a8", "#73ffb8"], vibe: "fresh startup energy, bright mint on deep green", tags: ["startup", "developer", "ai", "crypto"] },
  { id: "sunset-blaze", label: "Sunset Blaze", colors: ["#ff6b35", "#f7931e", "#e84393", "#6c5ce7"], vibe: "warm, dynamic orange-to-magenta", tags: ["creator", "events", "music", "consumer"] },
  { id: "forest-moss", label: "Forest & Moss", colors: ["#1a3c2a", "#2d5a3d", "#5a8a5c", "#a0c49d"], vibe: "organic, grounding deep greens", tags: ["outdoors", "sustainability", "farm", "wellness"] },
  { id: "autumn-harvest", label: "Autumn Harvest", colors: ["#5c2018", "#9b4423", "#d4842a", "#e8b84a"], vibe: "seasonal, rich amber and burgundy", tags: ["food", "restaurant", "artisan", "seasonal"] },
  { id: "brutalist-pop", label: "Brutalist Pop", colors: ["#ffffff", "#0a0a0a", "#ff5722", "#ffeb3b"], vibe: "neo-brutalist, high contrast with saturated accent", tags: ["agency", "portfolio", "creative", "punk"] },
  { id: "vapor-chrome", label: "Vapor Chrome", colors: ["#c4b5fd", "#818cf8", "#67e8f9", "#a5f3fc"], vibe: "Y2K futurism, iridescent pastels", tags: ["creator", "gaming", "web3", "consumer"] },
  { id: "navy-trust", label: "Navy Trust", colors: ["#0f1b3d", "#1e3a5f", "#3b6fa0", "#e8edf3"], vibe: "finance-grade navy with crisp white", tags: ["fintech", "law", "enterprise", "insurance"] },
  { id: "emerald-prestige", label: "Emerald Prestige", colors: ["#064e3b", "#0d7a5f", "#c9a84c", "#f5f0e0"], vibe: "luxury authority, rich emerald with gold", tags: ["luxury", "hospitality", "finance", "law"] },
];

export const FONT_PAIRS: FontPairPreset[] = [
  { id: "space-grotesk-dm-sans", label: "Space Grotesk + DM Sans", display: "Space Grotesk", body: "DM Sans", tags: ["saas", "developer", "ai", "startup"] },
  { id: "syne-plus-jakarta", label: "Syne + Plus Jakarta", display: "Syne", body: "Plus Jakarta Sans", tags: ["startup", "creative", "agency"] },
  { id: "outfit-figtree", label: "Outfit + Figtree", display: "Outfit", body: "Figtree", tags: ["lifestyle", "consumer", "wellness"] },
  { id: "sora-manrope", label: "Sora + Manrope", display: "Sora", body: "Manrope", tags: ["saas", "productivity", "b2b"] },
  { id: "urbanist-epilogue", label: "Urbanist + Epilogue", display: "Urbanist", body: "Epilogue", tags: ["architecture", "real-estate", "studio"] },
  { id: "instrument-serif-work-sans", label: "Instrument Serif + Work Sans", display: "Instrument Serif", body: "Work Sans", tags: ["editorial", "portfolio", "magazine"] },
  { id: "dm-serif-display-fira-sans", label: "DM Serif Display + Fira Sans", display: "DM Serif Display", body: "Fira Sans", tags: ["brand", "storytelling", "startup"] },
  { id: "cormorant-karla", label: "Cormorant + Karla", display: "Cormorant Garamond", body: "Karla", tags: ["luxury", "fashion", "hospitality"] },
  { id: "libre-baskerville-ibm-plex", label: "Libre Baskerville + IBM Plex", display: "Libre Baskerville", body: "IBM Plex Sans", tags: ["law", "finance", "consultancy"] },
  { id: "lora-nunito-sans", label: "Lora + Nunito Sans", display: "Lora", body: "Nunito Sans", tags: ["blog", "publishing", "editorial"] },
  { id: "bebas-neue-barlow", label: "Bebas Neue + Barlow", display: "Bebas Neue", body: "Barlow", tags: ["sports", "events", "fitness"] },
  { id: "archivo-black-hind", label: "Archivo Black + Hind", display: "Archivo Black", body: "Hind", tags: ["news", "activism", "editorial"] },
  { id: "abril-fatface-cabin", label: "Abril Fatface + Cabin", display: "Abril Fatface", body: "Cabin", tags: ["portfolio", "creative", "boutique"] },
  { id: "jetbrains-mono-work-sans", label: "JetBrains Mono + Work Sans", display: "JetBrains Mono", body: "Work Sans", tags: ["developer", "docs", "api"] },
  { id: "space-mono-rubik", label: "Space Mono + Rubik", display: "Space Mono", body: "Rubik", tags: ["indie", "gaming", "web3"] },
];

// Deterministic hash so the same project prompt gets the same picks on repeat
// generations — no jitter, no re-rolls. FNV-1a over UTF-16.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickTagged<T extends { tags: string[] }>(pool: T[], tags: string[], seed: string): T {
  const scored = pool.map((p) => ({ p, score: p.tags.reduce((n, t) => n + (tags.includes(t) ? 1 : 0), 0) }));
  const best = Math.max(...scored.map((s) => s.score));
  const eligible = best > 0 ? scored.filter((s) => s.score === best).map((s) => s.p) : pool;
  return eligible[hashString(seed) % eligible.length]!;
}

/** Infer archetype tags from a plain-English brief (cheap keyword scan). */
export function inferArchetypeTags(brief: string): string[] {
  const b = brief.toLowerCase();
  const tags: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/\b(saas|dashboard|platform|workspace|analytics|crm|erp|admin)\b/, "saas"],
    [/\b(fintech|bank|wallet|payment|invest|trading|lending|kyc|neobank)\b/, "fintech"],
    [/\b(developer|api|sdk|dev ?tool|open ?source|cli)\b/, "developer"],
    [/\b(ai|ml|llm|agent|chatbot|copilot|assistant)\b/, "ai"],
    [/\b(portfolio|freelanc|designer|photograph|artist)\b/, "portfolio"],
    [/\b(agency|studio|consultancy)\b/, "agency"],
    [/\b(restaurant|cafe|bakery|food|kitchen|menu|reservation)\b/, "food"],
    [/\b(hotel|resort|hospitality|booking|stay)\b/, "hospitality"],
    [/\b(gym|fitness|yoga|coach|training|wellness|spa|meditation)\b/, "wellness"],
    [/\b(law|legal|attorney|counsel)\b/, "law"],
    [/\b(luxury|premium|boutique|couture)\b/, "luxury"],
    [/\b(editorial|magazine|blog|news|journal|publication)\b/, "editorial"],
    [/\b(events?|conference|festival|meetup|ticket)\b/, "events"],
    [/\b(creator|influencer|streamer|podcast|music|artist)\b/, "creator"],
    [/\b(gaming|game|esports)\b/, "gaming"],
    [/\b(web3|crypto|nft|dao|token)\b/, "crypto"],
    [/\b(real ?estate|property|listing|architecture)\b/, "real-estate"],
    [/\b(sustainab|climate|green|organic|farm)\b/, "sustainability"],
    [/\b(healthcare|health|clinic|medical|patient|doctor)\b/, "healthcare"],
    [/\b(school|education|course|learning|student|tutor)\b/, "b2b"],
    [/\b(shop|store|ecommerce|retail|product|catalog)\b/, "consumer"],
  ];
  for (const [rx, tag] of map) if (rx.test(b)) tags.push(tag);
  if (tags.length === 0) tags.push("startup");
  return tags;
}

export interface DesignPick {
  palette: PalettePreset;
  fontPair: FontPairPreset;
  archetypeTags: string[];
}

export function pickDesignForBrief(brief: string): DesignPick {
  const tags = inferArchetypeTags(brief);
  const palette = pickTagged(PALETTES, tags, `p:${brief}`);
  const fontPair = pickTagged(FONT_PAIRS, tags, `f:${brief}`);
  return { palette, fontPair, archetypeTags: tags };
}
