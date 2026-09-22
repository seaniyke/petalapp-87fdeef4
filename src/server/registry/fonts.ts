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
  category: "sans" | "serif" | "display" | "mono";
  personality: string;
  weights: number[];
}

export interface FontPairing extends ResourceMeta {
  kind: "font-pairing";
  display: string;
  body: string;
}

export const FONTS: readonly FontRecord[] = [
  { id: "inter", kind: "font", label: "Inter", family: "Inter", category: "sans", personality: "neutral, dependable", weights: [400, 500, 600, 700], description: "Workhorse UI sans. Safe body font, weak as a display face.", tags: ["saas", "dashboard", "neutral", "technical", "body"], },
  { id: "geist", kind: "font", label: "Geist", family: "Geist", category: "sans", personality: "precise, modern", weights: [400, 500, 600, 700], description: "Tight modern sans with engineered feel.", tags: ["saas", "developer", "technical", "modern", "body"] },
  { id: "space-grotesk", kind: "font", label: "Space Grotesk", family: "Space Grotesk", category: "display", personality: "technical, confident", weights: [500, 600, 700], description: "Quirky geometric display with technical edge.", tags: ["developer", "ai", "startup", "technical", "display"] },
  { id: "plus-jakarta", kind: "font", label: "Plus Jakarta Sans", family: "Plus Jakarta Sans", category: "sans", personality: "friendly, rounded", weights: [400, 500, 600, 700, 800], description: "Warm geometric sans, works as display and body.", tags: ["startup", "consumer", "friendly", "fintech", "body", "display"] },
  { id: "dm-sans", kind: "font", label: "DM Sans", family: "DM Sans", category: "sans", personality: "calm, humane", weights: [400, 500, 700], description: "Low-contrast geometric sans, very readable at small sizes.", tags: ["consumer", "health", "calm", "body"] },
  { id: "manrope", kind: "font", label: "Manrope", family: "Manrope", category: "sans", personality: "clean, contemporary", weights: [400, 500, 600, 700, 800], description: "Semi-geometric sans with a distinct heavy weight.", tags: ["saas", "fintech", "modern", "body", "display"] },
  { id: "playfair", kind: "font", label: "Playfair Display", family: "Playfair Display", category: "serif", personality: "luxurious, editorial", weights: [400, 500, 600, 700], description: "High-contrast serif for luxury and editorial headlines.", tags: ["luxury", "editorial", "fashion", "hospitality", "display"] },
  { id: "instrument-serif", kind: "font", label: "Instrument Serif", family: "Instrument Serif", category: "serif", personality: "literary, sharp", weights: [400], description: "Narrow editorial serif with strong italics.", tags: ["editorial", "agency", "portfolio", "luxury", "display"] },
  { id: "fraunces", kind: "font", label: "Fraunces", family: "Fraunces", category: "serif", personality: "characterful, warm", weights: [400, 500, 600, 700, 900], description: "Soft wonky serif — warmth without stuffiness.", tags: ["food", "craft", "wellness", "warm", "display"] },
  { id: "lora", kind: "font", label: "Lora", family: "Lora", category: "serif", personality: "readable, traditional", weights: [400, 500, 600], description: "Book serif. Excellent long-form body copy.", tags: ["blog", "editorial", "education", "body"] },
  { id: "source-serif", kind: "font", label: "Source Serif 4", family: "Source Serif 4", category: "serif", personality: "trustworthy, institutional", weights: [400, 600, 700], description: "Serious serif for legal, medical and institutional work.", tags: ["legal", "medical", "corporate", "education", "body"] },
  { id: "bricolage", kind: "font", label: "Bricolage Grotesque", family: "Bricolage Grotesque", category: "display", personality: "expressive, editorial", weights: [500, 600, 700, 800], description: "Variable grotesque with strong personality at large sizes.", tags: ["agency", "portfolio", "editorial", "creative", "display"] },
  { id: "archivo", kind: "font", label: "Archivo", family: "Archivo", category: "sans", personality: "industrial, sturdy", weights: [500, 600, 700, 800], description: "Grotesque with wide weight range; good for brutalist work.", tags: ["brutalist", "industrial", "sports", "display", "body"] },
  { id: "outfit", kind: "font", label: "Outfit", family: "Outfit", category: "display", personality: "geometric, clean", weights: [400, 500, 600, 700], description: "Even geometric display, very neutral-modern.", tags: ["startup", "consumer", "modern", "display"] },
  { id: "jetbrains-mono", kind: "font", label: "JetBrains Mono", family: "JetBrains Mono", category: "mono", personality: "technical, precise", weights: [400, 500, 700], description: "Code and terminal typography, data labels.", tags: ["developer", "terminal", "technical", "mono"] },
  { id: "ibm-plex-mono", kind: "font", label: "IBM Plex Mono", family: "IBM Plex Mono", category: "mono", personality: "engineered, retro-technical", weights: [400, 500, 600], description: "Mono with warmth; good for eyebrows and metrics.", tags: ["developer", "data", "technical", "mono"] },
];

export const FONT_PAIRINGS: readonly FontPairing[] = [
  { id: "editorial-luxury", kind: "font-pairing", label: "Editorial luxury", display: "Playfair Display", body: "DM Sans", description: "High-contrast serif headlines over a calm sans body.", tags: ["luxury", "fashion", "hospitality", "editorial", "premium"] },
  { id: "literary", kind: "font-pairing", label: "Literary", display: "Instrument Serif", body: "Inter", description: "Narrow serif display with a neutral UI body.", tags: ["editorial", "agency", "portfolio", "blog"] },
  { id: "technical", kind: "font-pairing", label: "Technical", display: "Space Grotesk", body: "Inter", description: "Technical display with dependable body copy.", tags: ["developer", "ai", "saas", "technical", "startup"] },
  { id: "terminal", kind: "font-pairing", label: "Terminal", display: "JetBrains Mono", body: "Inter", description: "Mono headlines for developer tooling and status surfaces.", tags: ["developer", "terminal", "infrastructure", "data"] },
  { id: "modern-product", kind: "font-pairing", label: "Modern product", display: "Manrope", body: "Inter", description: "Contemporary sans throughout with weight contrast.", tags: ["saas", "fintech", "dashboard", "modern"] },
  { id: "friendly-consumer", kind: "font-pairing", label: "Friendly consumer", display: "Plus Jakarta Sans", body: "DM Sans", description: "Rounded geometric warmth for consumer apps.", tags: ["consumer", "community", "education", "friendly", "mobile"] },
  { id: "warm-craft", kind: "font-pairing", label: "Warm craft", display: "Fraunces", body: "Plus Jakarta Sans", description: "Characterful serif over friendly sans — food, wellness, craft.", tags: ["food", "restaurant", "wellness", "craft", "warm"] },
  { id: "institutional", kind: "font-pairing", label: "Institutional", display: "Source Serif 4", body: "Inter", description: "Serious serif for legal, medical and public-sector trust.", tags: ["legal", "medical", "corporate", "government", "education"] },
  { id: "industrial", kind: "font-pairing", label: "Industrial", display: "Archivo", body: "Archivo", description: "One heavy grotesque family for brutalist and sports work.", tags: ["brutalist", "sports", "industrial", "bold"] },
  { id: "expressive-studio", kind: "font-pairing", label: "Expressive studio", display: "Bricolage Grotesque", body: "Inter", description: "Loud variable display for studios and creative portfolios.", tags: ["agency", "creative", "portfolio", "studio"] },
  { id: "clean-startup", kind: "font-pairing", label: "Clean startup", display: "Outfit", body: "Inter", description: "Neutral-modern geometric display with a UI body.", tags: ["startup", "marketplace", "saas", "modern"] },
  { id: "reading", kind: "font-pairing", label: "Reading", display: "Lora", body: "Lora", description: "One serif family for long-form reading surfaces.", tags: ["blog", "newsletter", "publication", "education"] },
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
