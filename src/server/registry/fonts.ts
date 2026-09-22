/**
 * Font library + pairings.
 *
 * Before this existed, typography lived only inside the 25 visual
 * identities, so "change the font" had no vocabulary to choose from.
 * Fonts are now their own resource: an identity can reference a pairing
 * id, and typography can be swapped without touching structure.
 *
 * Every family here is on Google Fonts (open licence), so a build can
 * always load it from the font CDN without a licence question.
 */

import { type ResourceMeta, retrieve } from "./registry-types";

export interface FontRecord extends ResourceMeta {
  kind: "font";
  family: string;
  category: "sans" | "serif" | "display" | "mono" | "handwriting";
  personality: string;
  weights: number[];
  /** Where this family belongs. Drives retrieval alongside tags. */
  industries: string[];
  license: "ofl" | "apache" | "ufl";
}

export interface FontPairing extends ResourceMeta {
  kind: "font-pairing";
  display: string;
  body: string;
  industries: string[];
}

function font(
  id: string,
  family: string,
  category: FontRecord["category"],
  personality: string,
  weights: number[],
  description: string,
  tags: string[],
  industries: string[],
  license: FontRecord["license"] = "ofl",
): FontRecord {
  return {
    id,
    kind: "font",
    label: family,
    family,
    category,
    personality,
    weights,
    description,
    tags: [...tags, ...industries],
    industries,
    license,
  };
}

export const FONTS: readonly FontRecord[] = [
  // --- Sans: UI and body workhorses -------------------------------------
  font("inter", "Inter", "sans", "neutral, dependable", [400, 500, 600, 700], "Workhorse UI sans. Safe body font, weak as a display face.", ["neutral", "body", "ui"], ["saas", "dashboard", "technical"]),
  font("geist", "Geist", "sans", "precise, modern", [400, 500, 600, 700], "Tight modern sans with an engineered feel.", ["modern", "body", "ui"], ["saas", "developer", "technical"]),
  font("dm-sans", "DM Sans", "sans", "calm, humane", [400, 500, 700], "Low-contrast geometric sans, very readable at small sizes.", ["calm", "body"], ["consumer", "health", "wellness"]),
  font("plus-jakarta", "Plus Jakarta Sans", "sans", "friendly, rounded", [400, 500, 600, 700, 800], "Warm geometric sans that works as display and body.", ["friendly", "body", "display"], ["startup", "consumer", "fintech"]),
  font("manrope", "Manrope", "sans", "clean, contemporary", [400, 500, 600, 700, 800], "Semi-geometric sans with a distinct heavy weight.", ["modern", "body", "display"], ["saas", "fintech", "dashboard"]),
  font("figtree", "Figtree", "sans", "optimistic, approachable", [400, 500, 600, 700, 800], "Friendly geometric sans with excellent screen rendering.", ["friendly", "body", "display"], ["startup", "consumer", "education"]),
  font("public-sans", "Public Sans", "sans", "plain, civic", [400, 500, 600, 700], "Neutral government-grade sans; maximum legibility, no opinion.", ["neutral", "body", "accessible"], ["government", "civic", "corporate"]),
  font("work-sans", "Work Sans", "sans", "practical, open", [400, 500, 600, 700], "Optimised for mid-size screen text; open apertures.", ["neutral", "body"], ["corporate", "nonprofit", "education"]),
  font("nunito-sans", "Nunito Sans", "sans", "soft, welcoming", [400, 600, 700, 800], "Gently rounded terminals; reads as kind rather than corporate.", ["friendly", "body", "rounded"], ["health", "childcare", "community"]),
  font("rubik", "Rubik", "sans", "playful, sturdy", [400, 500, 600, 700], "Slightly rounded grotesque with real presence at large sizes.", ["friendly", "body", "display"], ["consumer", "sports", "events"]),
  font("ibm-plex-sans", "IBM Plex Sans", "sans", "engineered, honest", [400, 500, 600, 700], "Corporate sans with mechanical details; pairs with its own mono.", ["technical", "body"], ["enterprise", "developer", "industrial"]),
  font("sora", "Sora", "sans", "futuristic, squared", [400, 500, 600, 700, 800], "Squarish geometric sans with a near-future feel.", ["modern", "display", "body"], ["ai", "crypto", "startup"]),
  font("epilogue", "Epilogue", "sans", "editorial, tight", [400, 500, 600, 700, 800], "Tight-fitting sans with editorial personality in the bold weights.", ["editorial", "display"], ["agency", "fashion", "media"]),
  font("urbanist", "Urbanist", "sans", "airy, geometric", [400, 500, 600, 700], "Low-contrast geometric with a light, spacious feel.", ["minimal", "body", "display"], ["architecture", "interior", "portfolio"]),
  font("onest", "Onest", "sans", "neutral-warm", [400, 500, 600, 700], "Contemporary neutral sans with subtly humanist curves.", ["neutral", "body"], ["saas", "consumer", "marketplace"]),
  font("schibsted-grotesk", "Schibsted Grotesk", "sans", "newsy, direct", [400, 500, 600, 700], "News-grade grotesque; strong headlines, workable body.", ["editorial", "display", "body"], ["media", "publication", "news"]),

  // --- Display -----------------------------------------------------------
  font("space-grotesk", "Space Grotesk", "display", "technical, confident", [500, 600, 700], "Quirky geometric display with a technical edge.", ["technical", "display"], ["developer", "ai", "startup"]),
  font("outfit", "Outfit", "display", "geometric, clean", [400, 500, 600, 700], "Even geometric display, very neutral-modern.", ["modern", "display"], ["startup", "consumer", "marketplace"]),
  font("bricolage", "Bricolage Grotesque", "display", "expressive, editorial", [500, 600, 700, 800], "Variable grotesque with strong personality at large sizes.", ["expressive", "display"], ["agency", "portfolio", "creative"]),
  font("archivo", "Archivo", "sans", "industrial, sturdy", [500, 600, 700, 800], "Grotesque with a wide weight range; good for brutalist work.", ["bold", "display", "body"], ["brutalist", "industrial", "sports"]),
  font("bebas-neue", "Bebas Neue", "display", "loud, condensed", [400], "All-caps condensed display; posters, sports, events.", ["bold", "condensed", "display"], ["sports", "events", "nightlife"]),
  font("anton", "Anton", "display", "heavy, poster-like", [400], "Very heavy condensed display for one-word statements.", ["bold", "condensed", "display"], ["sports", "streetwear", "events"]),
  font("syne", "Syne", "display", "art-school, odd", [400, 600, 700, 800], "Contemporary art-gallery display with unusual widths.", ["expressive", "display"], ["gallery", "music", "creative"]),
  font("unbounded", "Unbounded", "display", "bold, futuristic", [400, 600, 700, 800], "Wide geometric display with strong brand presence.", ["bold", "display"], ["crypto", "gaming", "ai"]),
  font("clash-alt", "Familjen Grotesk", "display", "crisp, nordic", [400, 500, 600, 700], "Clean nordic grotesque with sharp display weights.", ["modern", "display"], ["design", "architecture", "agency"]),

  // --- Serif --------------------------------------------------------------
  font("playfair", "Playfair Display", "serif", "luxurious, editorial", [400, 500, 600, 700], "High-contrast serif for luxury and editorial headlines.", ["luxury", "display"], ["fashion", "hospitality", "editorial"]),
  font("instrument-serif", "Instrument Serif", "serif", "literary, sharp", [400], "Narrow editorial serif with strong italics.", ["editorial", "display"], ["agency", "portfolio", "publication"]),
  font("fraunces", "Fraunces", "serif", "characterful, warm", [400, 500, 600, 700, 900], "Soft wonky serif — warmth without stuffiness.", ["warm", "display"], ["food", "craft", "wellness"]),
  font("lora", "Lora", "serif", "readable, traditional", [400, 500, 600], "Book serif. Excellent long-form body copy.", ["readable", "body"], ["blog", "editorial", "education"]),
  font("source-serif", "Source Serif 4", "serif", "trustworthy, institutional", [400, 600, 700], "Serious serif for legal, medical and institutional work.", ["trust", "body"], ["legal", "medical", "corporate"]),
  font("dm-serif-display", "DM Serif Display", "serif", "elegant, high-contrast", [400], "Refined display serif for premium headlines.", ["luxury", "display"], ["hospitality", "beauty", "realestate"]),
  font("cormorant", "Cormorant Garamond", "serif", "delicate, classical", [400, 500, 600, 700], "Fine old-style serif; weddings, galleries, fine dining.", ["luxury", "delicate", "display"], ["wedding", "gallery", "finedining"]),
  font("newsreader", "Newsreader", "serif", "journalistic, calm", [400, 500, 600, 700], "Screen-first reading serif with optical sizes.", ["readable", "body", "editorial"], ["news", "publication", "blog"]),
  font("spectral", "Spectral", "serif", "considered, technical", [400, 500, 600, 700], "Screen serif with a slightly technical texture.", ["readable", "body"], ["research", "education", "documentation"]),
  font("libre-baskerville", "Libre Baskerville", "serif", "classic, bookish", [400, 700], "Traditional bookface tuned for screens.", ["readable", "body"], ["publishing", "law", "education"]),
  font("crimson-pro", "Crimson Pro", "serif", "scholarly, quiet", [400, 500, 600, 700], "Old-style text serif for long academic reading.", ["readable", "body"], ["academic", "library", "nonprofit"]),

  // --- Mono ---------------------------------------------------------------
  font("jetbrains-mono", "JetBrains Mono", "mono", "technical, precise", [400, 500, 700], "Code and terminal typography, data labels.", ["technical", "mono"], ["developer", "terminal", "infrastructure"]),
  font("ibm-plex-mono", "IBM Plex Mono", "mono", "engineered, retro-technical", [400, 500, 600], "Mono with warmth; good for eyebrows and metrics.", ["technical", "mono"], ["developer", "data", "industrial"]),
  font("space-mono", "Space Mono", "mono", "retro, quirky", [400, 700], "Characterful mono for labels and statement type.", ["retro", "mono", "display"], ["creative", "crypto", "zine"]),
  font("dm-mono", "DM Mono", "mono", "clean, low-key", [400, 500], "Quiet mono for tabular data and captions.", ["neutral", "mono"], ["fintech", "data", "dashboard"]),

  // --- Handwriting (use sparingly) ----------------------------------------
  font("caveat", "Caveat", "handwriting", "personal, sketchy", [400, 600, 700], "Handwritten accent — annotations only, never body copy.", ["accent", "handwriting"], ["education", "personal", "craft"]),
];

function pairing(
  id: string,
  label: string,
  display: string,
  body: string,
  description: string,
  tags: string[],
  industries: string[],
): FontPairing {
  return {
    id,
    kind: "font-pairing",
    label,
    display,
    body,
    description,
    tags: [...tags, ...industries],
    industries,
  };
}

export const FONT_PAIRINGS: readonly FontPairing[] = [
  pairing("editorial-luxury", "Editorial luxury", "Playfair Display", "DM Sans", "High-contrast serif headlines over a calm sans body.", ["luxury", "premium"], ["fashion", "hospitality", "editorial"]),
  pairing("literary", "Literary", "Instrument Serif", "Inter", "Narrow serif display with a neutral UI body.", ["editorial"], ["agency", "portfolio", "blog"]),
  pairing("technical", "Technical", "Space Grotesk", "Inter", "Technical display with dependable body copy.", ["technical"], ["developer", "ai", "saas"]),
  pairing("terminal", "Terminal", "JetBrains Mono", "Inter", "Mono headlines for developer tooling and status surfaces.", ["technical", "mono"], ["developer", "terminal", "infrastructure"]),
  pairing("modern-product", "Modern product", "Manrope", "Inter", "Contemporary sans throughout with weight contrast.", ["modern"], ["saas", "fintech", "dashboard"]),
  pairing("friendly-consumer", "Friendly consumer", "Plus Jakarta Sans", "DM Sans", "Rounded geometric warmth for consumer apps.", ["friendly", "mobile"], ["consumer", "community", "education"]),
  pairing("warm-craft", "Warm craft", "Fraunces", "Plus Jakarta Sans", "Characterful serif over friendly sans — food, wellness, craft.", ["warm"], ["food", "restaurant", "wellness"]),
  pairing("institutional", "Institutional", "Source Serif 4", "Inter", "Serious serif for legal, medical and public-sector trust.", ["trust"], ["legal", "medical", "corporate"]),
  pairing("industrial", "Industrial", "Archivo", "Archivo", "One heavy grotesque family for brutalist and sports work.", ["bold"], ["brutalist", "sports", "industrial"]),
  pairing("expressive-studio", "Expressive studio", "Bricolage Grotesque", "Inter", "Loud variable display for studios and creative portfolios.", ["expressive"], ["agency", "creative", "portfolio"]),
  pairing("clean-startup", "Clean startup", "Outfit", "Inter", "Neutral-modern geometric display with a UI body.", ["modern"], ["startup", "marketplace", "saas"]),
  pairing("reading", "Reading", "Lora", "Lora", "One serif family for long-form reading surfaces.", ["readable"], ["blog", "newsletter", "publication"]),
  pairing("newsroom", "Newsroom", "Schibsted Grotesk", "Newsreader", "Grotesque headlines over a screen-reading serif.", ["editorial", "readable"], ["news", "media", "publication"]),
  pairing("fine-dining", "Fine dining", "Cormorant Garamond", "Figtree", "Delicate classical serif with a quiet modern body.", ["luxury", "delicate"], ["finedining", "wedding", "gallery"]),
  pairing("premium-stay", "Premium stay", "DM Serif Display", "Manrope", "Elegant display serif for property, beauty and hospitality.", ["luxury"], ["realestate", "beauty", "hospitality"]),
  pairing("stadium", "Stadium", "Bebas Neue", "Rubik", "Condensed all-caps headlines with a sturdy body.", ["bold", "condensed"], ["sports", "events", "nightlife"]),
  pairing("gallery", "Gallery", "Syne", "Work Sans", "Art-school display over plain, out-of-the-way body text.", ["expressive"], ["gallery", "music", "creative"]),
  pairing("future-network", "Future network", "Unbounded", "Sora", "Wide futuristic display with a squared body sans.", ["bold", "futuristic"], ["crypto", "gaming", "ai"]),
  pairing("care", "Care", "Nunito Sans", "Nunito Sans", "One soft family throughout for health and community work.", ["friendly", "rounded"], ["health", "childcare", "community"]),
  pairing("civic", "Civic", "Public Sans", "Public Sans", "Plain accessible sans for public services and forms.", ["neutral", "accessible"], ["government", "civic", "nonprofit"]),
  pairing("enterprise", "Enterprise", "IBM Plex Sans", "IBM Plex Sans", "One engineered family with its mono sibling for data.", ["technical"], ["enterprise", "industrial", "developer"]),
  pairing("academic", "Academic", "Libre Baskerville", "Crimson Pro", "Bookish display over a quiet scholarly text face.", ["readable"], ["academic", "library", "publishing"]),
  pairing("studio-nordic", "Studio nordic", "Familjen Grotesk", "Urbanist", "Crisp nordic display with an airy geometric body.", ["minimal"], ["design", "architecture", "interior"]),
  pairing("data-desk", "Data desk", "Geist", "DM Mono", "Precise sans headings with a mono body for figures.", ["technical", "mono"], ["fintech", "data", "dashboard"]),
];

/** Look up a pairing by id. */
export function findPairing(id: string): FontPairing | null {
  return FONT_PAIRINGS.find((p) => p.id === id) ?? null;
}

/** Retrieve the pairings worth offering for this brief. */
export function pickFontPairings(briefTags: string[], briefText = "", limit = 4): FontPairing[] {
  return retrieve(FONT_PAIRINGS, briefTags, limit, briefText);
}

/** Find the font record behind a family name, when we know it. */
export function findFont(family: string): FontRecord | null {
  const f = family.trim().toLowerCase();
  return FONTS.find((r) => r.family.toLowerCase() === f) ?? null;
}

/** Families we can safely load — anything outside this list is a licence risk. */
export const FONT_ALLOWLIST: ReadonlySet<string> = new Set(FONTS.map((f) => f.family));

/**
 * Prompt block: a SHORT menu of pairings, not the whole library.
 * Returns "" when nothing is worth saying.
 */
export function renderFontBlock(briefTags: string[], briefText = ""): string {
  const picks = pickFontPairings(briefTags, briefText, 4);
  if (!picks.length) return "";
  const lines = picks.map(
    (p) => `- ${p.id}: ${p.display} headings / ${p.body} body — ${p.description}`,
  );
  return [
    ``,
    `[Typography — pick ONE pairing]`,
    `Load both families from Google Fonts in the document head and wire them to the font tokens. Do not invent a third family.`,
    ...lines,
    `Rules: headings and body must differ in weight or family, never only in size. Body copy stays 16px or larger. Long-form text caps at ~70 characters per line.`,
  ].join("\n");
}
