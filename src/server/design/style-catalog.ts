/**
 * The public style vocabulary: page layouts and looks a caller may choose.
 * Pure constants — shared by the public API, the MCP tools, the design
 * director and the package authority so every surface accepts the same words.
 */

/** How a site's public pages are composed. Never adds pages or sections. */
export const LAYOUT_ARCHETYPE_IDS = [
  "bento-showcase",
  "editorial-magazine",
  "split-screen",
  "app-first",
  "visual-gallery",
  "swiss-minimal",
] as const;
export type LayoutArchetypeId = (typeof LAYOUT_ARCHETYPE_IDS)[number];

/** Installed design-system packages a caller may pick as the look. */
export const PUBLIC_LOOK_SLUGS = [
  "substrate",
  "meridian",
  "atelier",
  "haven",
  "obsidian",
  "kinetic",
  "monolith",
  "brutalist",
  "bloom",
] as const;
export type PublicLookSlug = (typeof PUBLIC_LOOK_SLUGS)[number];

export function isLayoutArchetype(v: unknown): v is LayoutArchetypeId {
  return typeof v === "string" && (LAYOUT_ARCHETYPE_IDS as readonly string[]).includes(v);
}

export function isPublicLook(v: unknown): v is PublicLookSlug {
  return typeof v === "string" && (PUBLIC_LOOK_SLUGS as readonly string[]).includes(v);
}

/** A caller's optional style choice for a project's first build. */
export interface DesignStyleChoice {
  layout?: LayoutArchetypeId;
  look?: PublicLookSlug;
}

/** Keep only recognised values; anything else is dropped, never an error downstream. */
export function sanitizeStyleChoice(raw: unknown): DesignStyleChoice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: DesignStyleChoice = {};
  if (isLayoutArchetype(r.layout)) out.layout = r.layout;
  if (isPublicLook(r.look)) out.look = r.look;
  return out.layout || out.look ? out : null;
}

/** Stable 32-bit FNV-1a hash so one seed always resolves to the same pick. */
export function styleSeedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
