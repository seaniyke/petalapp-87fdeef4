/**
 * Header architectures + decorative treatments.
 *
 * Footers already had a variant menu in section-library.server.ts;
 * headers did not, so every project converged on the same sticky
 * logo-left / links-centre / one-button bar. Decorative treatments got
 * the same treatment: a small named set with a rule for when they help.
 */

import { type ResourceMeta, retrieve } from "./registry-types";

export interface HeaderRecord extends ResourceMeta {
  kind: "header";
}

export interface DecorationRecord extends ResourceMeta {
  kind: "decoration";
}

export const HEADERS: readonly HeaderRecord[] = [
  { id: "header-minimal", kind: "header", label: "Minimal", description: "Logo left, three or four links right, no CTA button. Thin border-bottom only on scroll.", tags: ["portfolio", "editorial", "agency", "blog", "calm"] },
  { id: "header-standard", kind: "header", label: "Standard product bar", description: "Logo left, link group centre, one ghost link + one primary CTA right. Sticky with a blurred translucent background after 8px of scroll.", tags: ["saas", "startup", "marketplace", "product"] },
  { id: "header-transparent", kind: "header", label: "Transparent over hero", description: "Sits on top of a full-bleed hero image with light text, then solidifies into the surface colour on scroll.", tags: ["hospitality", "travel", "restaurant", "real-estate", "luxury"] },
  { id: "header-centered", kind: "header", label: "Centred logo", description: "Logo centred on its own row, navigation split left and right beneath it. Editorial and luxury feel.", tags: ["luxury", "fashion", "editorial", "hospitality"] },
  { id: "header-mega", kind: "header", label: "Mega menu", description: "One or two links open a full-width panel with grouped links, short descriptions and a featured tile. Use only when there are genuinely more than 12 destinations.", tags: ["enterprise", "corporate", "commerce", "b2b", "platform"] },
  { id: "header-commerce", kind: "header", label: "Commerce bar", description: "Two rows: announcement strip on top, then logo, category links, search field, account and cart with a count badge.", tags: ["commerce", "marketplace", "retail", "store"] },
  { id: "header-app", kind: "header", label: "App shell", description: "Slim top bar with a workspace switcher, search, notifications and avatar menu; primary navigation lives in a left sidebar.", tags: ["dashboard", "app", "admin", "saas", "internal"] },
  { id: "header-docs", kind: "header", label: "Docs bar", description: "Logo, version pill, search with a keyboard hint, and icon links to repo and community. Sidebar carries the tree.", tags: ["developer", "docs", "knowledge-base", "technical"] },
];

export const DECORATIONS: readonly DecorationRecord[] = [
  { id: "deco-mesh", kind: "decoration", label: "Mesh gradient", description: "Two or three soft colour blobs blurred behind the hero at low opacity. One per page, hero only.", tags: ["saas", "startup", "ai", "modern"] },
  { id: "deco-grid", kind: "decoration", label: "Grid lines", description: "Faint 1px grid or dot field behind the hero, fading out towards the fold.", tags: ["developer", "technical", "ai", "infrastructure"] },
  { id: "deco-noise", kind: "decoration", label: "Film grain", description: "Very low-opacity noise overlay on dark surfaces to kill banding.", tags: ["dark", "luxury", "editorial", "cinematic"] },
  { id: "deco-image-overlay", kind: "decoration", label: "Image overlay", description: "Dark-to-transparent gradient over a photograph so text stays readable. Mandatory whenever text sits on a photo.", tags: ["hospitality", "travel", "restaurant", "real-estate", "photography"] },
  { id: "deco-shape", kind: "decoration", label: "Cut shapes", description: "Large flat geometric shapes bleeding off the edge of a section.", tags: ["brutalist", "playful", "kids", "sports"] },
  { id: "deco-rule", kind: "decoration", label: "Editorial rules", description: "Hairline horizontal rules and generous margins instead of cards.", tags: ["editorial", "luxury", "portfolio", "minimal"] },
  { id: "deco-none", kind: "decoration", label: "No decoration", description: "Colour, type and spacing carry the page. Correct choice for medical, legal and institutional work.", tags: ["medical", "legal", "corporate", "government", "calm"] },
];

export function pickHeaders(briefTags: string[], briefText = "", limit = 4): HeaderRecord[] {
  return retrieve(HEADERS, briefTags, limit, briefText);
}

export function pickDecorations(briefTags: string[], briefText = "", limit = 3): DecorationRecord[] {
  return retrieve(DECORATIONS, briefTags, limit, briefText);
}

/** Prompt block: header menu + decorative treatments, short by design. */
export function renderHeaderBlock(briefTags: string[], briefText = ""): string {
  const headers = pickHeaders(briefTags, briefText, 4);
  const decos = pickDecorations(briefTags, briefText, 3);
  if (!headers.length) return "";
  const lines: string[] = [];
  lines.push(``, `[Header — pick ONE]`);
  for (const h of headers) lines.push(`- ${h.id}: ${h.description}`);
  lines.push(
    `Every header ships a real mobile treatment: a sheet or full-screen menu with 44px touch targets, focus trapping, and an opaque background — never a see-through panel.`,
  );
  if (decos.length) {
    lines.push(``, `[Decoration — at most one, and "none" is a valid answer]`);
    for (const d of decos) lines.push(`- ${d.id}: ${d.description}`);
    lines.push(`Decoration must never reduce text contrast or compete with the product imagery. If it is not adding meaning, drop it.`);
  }
  return lines.join("\n");
}
