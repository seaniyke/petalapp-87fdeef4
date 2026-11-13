/**
 * Layout archetypes — how a project's public pages are COMPOSED.
 *
 * The design package owns colours and fonts; the archetype owns the page
 * structure (hero shape, grid, rhythm, how content is grouped). Without it the
 * builder defaulted to the same centred-hero → three cards → pricing → FAQ
 * formula for every brief.
 *
 * Deterministic and pure: explicit layout words in the brief win; otherwise
 * the brief's family gives a short list of fitting archetypes and the project
 * seed picks one, so two projects with similar briefs get different layouts
 * while one project always keeps its own.
 *
 * Scope rule: an archetype never adds pages, sections or features. It only
 * decides how the content the person asked for is arranged.
 */
import { LAYOUT_ARCHETYPE_IDS, styleSeedHash, type LayoutArchetypeId } from "./style-catalog";

export { LAYOUT_ARCHETYPE_IDS, type LayoutArchetypeId } from "./style-catalog";

interface ArchetypeSpec {
  name: string;
  summary: string;
  rules: string[];
}

export const LAYOUT_ARCHETYPES: Record<LayoutArchetypeId, ArchetypeSpec> = {
  "bento-showcase": {
    name: "Bento showcase",
    summary: "dense asymmetric tile grid with live product moments above the fold",
    rules: [
      "Open with a headline block plus an asymmetric bento grid (one 2×2 tile, supporting 2×1 and 1×1 tiles) instead of a centred hero with a single image.",
      "Each tile holds a different content type: a real UI fragment, a big metric, a short quote, a mini chart, a photo — never the same icon + title + sentence repeated.",
      "Further sections reuse the bento rhythm at different spans; avoid rows of equal cards.",
    ],
  },
  "editorial-magazine": {
    name: "Editorial magazine",
    summary: "large type, multi-column editorial layout, generous white space and image captions",
    rules: [
      "Open like a magazine cover: an oversized headline set across most of the width, a lead image with a caption, and a short standfirst paragraph.",
      "Lay content out in editorial columns (e.g. 7/5 or 8/4 splits) with pull quotes, numbered chapter headers and captioned photography.",
      "Let white space and type scale create hierarchy; use cards sparingly or not at all.",
    ],
  },
  "split-screen": {
    name: "Split screen",
    summary: "50/50 viewport split — sticky brand side, scrolling or interactive side",
    rules: [
      "Open with a two-column split filling the first screen: one side carries the headline, key facts and primary action; the other carries a large photo, a live preview, or the main interactive element (booking, selector, form).",
      "On desktop, keep the brand/heading side sticky (`md:sticky md:top-0 md:h-screen`) while the other side scrolls through the content.",
      "On phones the split stacks: heading first, media or interaction directly below.",
    ],
  },
  "app-first": {
    name: "App first",
    summary: "opens directly on the working tool — no marketing preamble",
    rules: [
      "The home screen IS the product: open on the working tool, search, catalogue, editor or dashboard inside a clean app shell.",
      "No marketing hero, testimonials or pricing on the home screen unless the person asked for them; a short one-line intro above the tool is enough.",
      "Spend the effort on real states: empty, loading, filled, error.",
    ],
  },
  "visual-gallery": {
    name: "Visual gallery",
    summary: "masonry and edge-to-edge photography with overlays",
    rules: [
      "Open with full-bleed photography or a masonry/staggered image grid; the headline sits over or beside the imagery, not in an empty centred block.",
      "Use varied image sizes and aspect ratios in a staggered grid (CSS columns or a mixed-span grid) with captions or hover overlays carrying names, prices or details.",
      "Text sections stay short and sit between image runs.",
    ],
  },
  "swiss-minimal": {
    name: "Swiss minimal",
    summary: "strict grid, crisp rules, numbered sections and tabular data",
    rules: [
      "Use a visible 12-column grid: a narrow label column (e.g. section number and title) beside a wide content column.",
      "Separate sections with full-width hairline rules and numbered headings (01, 02, 03) instead of background bands and cards.",
      "Present services, prices, specs or projects as rows and tables rather than icon cards; no decorative shadows.",
    ],
  },
};

const EXPLICIT: Array<{ id: LayoutArchetypeId; re: RegExp }> = [
  { id: "bento-showcase", re: /\bbento\b/i },
  { id: "split-screen", re: /\bsplit[- ]?screen\b/i },
  { id: "visual-gallery", re: /\b(masonry|gallery[- ](style|layout|grid))\b/i },
  { id: "editorial-magazine", re: /\b(editorial|magazine)[- ](style|layout|look|feel)\b/i },
  { id: "swiss-minimal", re: /\b(swiss|brutalis[tm]|bauhaus)\w*/i },
];

/** Family → fitting archetypes, first = the default when no seed is given. */
const FAMILIES: Array<{ re: RegExp; ids: LayoutArchetypeId[] }> = [
  // Single-purpose tools: the tool is the page.
  { re: /\b(calculator|converter|generator|timer|tracker|to-?do|todo|planner|editor|tool|dashboard|admin panel|crm|inventory|internal)\b/i, ids: ["app-first", "bento-showcase"] },
  { re: /\b(saas|software|developer|api|fintech|analytic|platform|startup|ai (tool|product|platform|app)|automation)\w*/i, ids: ["bento-showcase", "split-screen", "swiss-minimal"] },
  { re: /\b(legal|law firm|lawyer|attorney|accounting|consult\w*|logistic\w*|freight|engineering|construction|architect\w*|crypto|web3|blockchain|research)\b/i, ids: ["swiss-minimal", "split-screen", "bento-showcase"] },
  { re: /\b(clinic|hospital|health|medical|dental|dentist|doctor|therap\w*|school|tutor\w*|course|education|charity|nonprofit)\b/i, ids: ["split-screen", "editorial-magazine", "bento-showcase"] },
  { re: /\b(hotel|resort|retreat|booking|reservation|rental|travel|tour)\w*/i, ids: ["split-screen", "visual-gallery", "editorial-magazine"] },
  { re: /\b(restaurant|bakery|baker|cafe|caf\u00e9|coffee|bistro|kitchen|catering|bar|wine|salon|beauty|spa|skincare|fashion|boutique|wedding|florist)\w*/i, ids: ["editorial-magazine", "visual-gallery", "split-screen"] },
  { re: /\b(shops?|stores?|ecommerce|e-commerce|marketplace|portfolio|photograph\w*|gallery|artists?|creators?|studio|furniture|jewel\w*)\b/i, ids: ["visual-gallery", "editorial-magazine", "bento-showcase"] },
  { re: /\b(fitness|gym|sports?|events?|festivals?|music|bands?|dj|gaming|esports)\b/i, ids: ["visual-gallery", "split-screen", "bento-showcase"] },
];

const DEFAULT_IDS: LayoutArchetypeId[] = ["editorial-magazine", "split-screen", "bento-showcase", "visual-gallery", "swiss-minimal"];

/**
 * Pick the archetype for a brief. Explicit layout words win; otherwise the
 * family's list, chosen by `seed` (first entry when no seed is given).
 */
export function pickLayoutArchetype(brief: string | null | undefined, seed?: string | null): LayoutArchetypeId {
  const text = (brief ?? "").slice(0, 4000);
  const explicit = EXPLICIT.find((e) => e.re.test(text));
  if (explicit) return explicit.id;
  const family = FAMILIES.find((f) => f.re.test(text));
  const ids = family?.ids ?? DEFAULT_IDS;
  if (!seed) return ids[0]!;
  return ids[styleSeedHash(`layout:${seed}`) % ids.length]!;
}

/** Prompt block for the committed archetype. */
export function renderLayoutArchetypeBlock(id: LayoutArchetypeId | null | undefined, detail: "full" | "compact" = "full"): string {
  if (!id || !LAYOUT_ARCHETYPES[id]) return "";
  const a = LAYOUT_ARCHETYPES[id];
  if (detail === "compact") {
    return `- layout archetype: ${a.name} (${a.summary}). New content on public pages follows this composition.\n`;
  }
  return (
    `\n\n### Layout archetype (committed for this project — compose public pages this way)\n` +
    `${a.name}: ${a.summary}.\n` +
    a.rules.map((r) => `- ${r}`).join("\n") +
    `\n- This decides HOW the requested content is arranged. It never adds pages, sections or features the person did not ask for.` +
    `\n- It replaces the generic stack of centred hero → three icon cards → testimonials → pricing → FAQ. Keep only the sections the request needs; the archetype changes their SHAPE, not the visitor's question order.` +
    `\n- Signed-in app screens and dashboards keep the app layout rules; this applies to public pages.\n`
  );
}
