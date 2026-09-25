/**
 * Design Knowledge — reusable, STRUCTURED design craft available to the
 * generator, loaded conditionally. Deterministic; no AI call selects it.
 *
 * Two sources, never confused:
 *   PROJECT DESIGN LANGUAGE  (design-intel.ts)  — what the project already is.
 *   DESIGN KNOWLEDGE         (this file)        — craft the generator may use.
 *
 * Precedence: user's current request  >  project design language  >
 * category defaults  >  general craft. On an edit that isn't a redesign the
 * project language is authoritative and knowledge is limited to the topics
 * the request actually touches, framed as "fit the existing system".
 */

export type DesignTopic =
  | "typography" | "type_hierarchy" | "color" | "spacing" | "layout" | "grid" | "containers"
  | "responsive" | "navigation" | "hero" | "sections" | "cards" | "buttons" | "forms" | "tables"
  | "dashboards" | "imagery" | "iconography" | "borders" | "radius" | "shadows" | "motion"
  | "accessibility" | "visual_hierarchy" | "composition";

/** One rule per line, short, checkable. Never a prose manual. */
export const DESIGN_KNOWLEDGE: Record<DesignTopic, { triggers: RegExp; rules: string[] }> = {
  typography: { triggers: /\b(font|typeface|typograph|text style|serif|sans)\b/i, rules: ["Max 2 families: one display, one body; load via <link>, reference via tokens.", "Body 16–18px, line-height 1.5–1.7; headings line-height 1.05–1.2, slight negative tracking."] },
  type_hierarchy: { triggers: /\b(heading|headline|title|hierarchy|bigger|smaller|text size)\b/i, rules: ["Use a 6-step modular scale; each level visibly distinct (≥1.2× ratio).", "One h1 per page; don't skip heading levels."] },
  color: { triggers: /\b(colou?r|palette|theme|dark|light|brand|accent|contrast)\b/i, rules: ["All color via semantic tokens (background, foreground, primary, muted, accent, border); no hardcoded hex/utility colors in components.", "One primary accent used sparingly for action; neutrals carry the surface."] },
  spacing: { triggers: /\b(spacing|padding|margin|gap|whitespace|cramped|airy|tight)\b/i, rules: ["4-point scale; section padding 64–128px desktop, 48–72px mobile.", "Related items closer than unrelated ones (proximity groups)."] },
  layout: { triggers: /\b(layout|arrange|column|split|align|position)\b/i, rules: ["Pick one alignment axis per section; avoid centered-everything.", "Asymmetry is fine when weight is balanced."] },
  grid: { triggers: /\b(grid|columns?|masonry|bento)\b/i, rules: ["12-column mental grid; 1 col mobile, 2 tablet, 3–4 desktop for card grids.", "Consistent gutters within a grid."] },
  containers: { triggers: /\b(container|max.?width|wide|narrow|full.?width)\b/i, rules: ["Content max-width ~1200–1280px; prose 60–75ch.", "Full-bleed backgrounds with contained content."] },
  responsive: { triggers: /\b(mobile|responsive|tablet|phone|breakpoint|small screen)\b/i, rules: ["Mobile-first from 390px; no horizontal scroll.", "Tap targets ≥44px; nav collapses to a menu below md."] },
  navigation: { triggers: /\b(nav|navbar|menu|header|links?)\b/i, rules: ["Brand left, ≤6 primary links, one primary CTA right.", "Nav links only to pages that exist."] },
  hero: { triggers: /\b(hero|above the fold|banner|headline)\b/i, rules: ["One clear promise headline, one supporting line, one primary + optional secondary action.", "Visual (image/product/illustration) supports the claim, never decorative filler."] },
  sections: { triggers: /\b(section|block|testimonial|faq|feature|pricing|cta)\b/i, rules: ["Add only sections the user asked for or the category clearly needs; never pad with generic sections.", "Alternate density/background between adjacent sections for rhythm."] },
  cards: { triggers: /\b(card|tile|listing|item)\b/i, rules: ["Consistent card anatomy across the app: media, title, meta, action.", "Equal heights within a row; whole card clickable when it links."] },
  buttons: { triggers: /\b(button|cta|call to action)\b/i, rules: ["Primary / secondary / ghost variants from one component; one primary per view region.", "Visible hover, focus-visible ring, disabled state; verbs as labels."] },
  forms: { triggers: /\b(form|input|field|sign ?up|login|checkout|contact)\b/i, rules: ["Labels above inputs, never placeholder-only; inline validation messages.", "Group related fields; primary submit full-width on mobile."] },
  tables: { triggers: /\b(table|rows?|spreadsheet|list view|data grid)\b/i, rules: ["Right-align numbers, tabular figures; sticky header for long tables.", "Horizontal scroll container on mobile; empty and loading states."] },
  dashboards: { triggers: /\b(dashboard|admin|analytics|metrics|kpi|chart)\b/i, rules: ["Sidebar or top nav + content; KPIs first, detail below.", "Dense but scannable: 14px UI text, muted labels, strong values."] },
  imagery: { triggers: /\b(image|photo|picture|illustration|gallery|visual)\b/i, rules: ["Consistent aspect ratios and treatment; reuse existing assets before generating new ones.", "Meaningful alt text; object-cover with fixed ratio boxes."] },
  iconography: { triggers: /\b(icon|glyph|symbol)\b/i, rules: ["One icon set (lucide), one stroke weight, sized to text (16–20px).", "Icons support labels, never replace them for primary actions."] },
  borders: { triggers: /\b(border|outline|divider|line)\b/i, rules: ["Hairline borders via border token; use either borders or shadows for elevation, not both heavily."] },
  radius: { triggers: /\b(radius|rounded|corner|pill|sharp)\b/i, rules: ["One radius token family; nested radius = outer − padding."] },
  shadows: { triggers: /\b(shadow|elevation|depth|float)\b/i, rules: ["Soft, low-opacity shadows tinted by the palette; max 3 elevation levels."] },
  motion: { triggers: /\b(animat|motion|transition|hover|scroll effect|fade)\b/i, rules: ["150–300ms ease-out for UI; entrance animations subtle and once.", "Respect prefers-reduced-motion."] },
  accessibility: { triggers: /\b(accessib|a11y|contrast|screen reader|keyboard|aria)\b/i, rules: ["WCAG AA contrast (4.5:1 text); keyboard reachable; visible focus.", "Semantic landmarks: header, nav, main, footer."] },
  visual_hierarchy: { triggers: /\b(hierarchy|emphasis|stand out|focus|attention|busy|cluttered)\b/i, rules: ["One focal point per viewport; size > weight > color for emphasis.", "Reduce competing accents before adding new ones."] },
  composition: { triggers: /\b(composition|balance|rhythm|flow|structure)\b/i, rules: ["Consistent section rhythm; repeat patterns across pages so the site reads as one system."] },
};

export type SiteCategory =
  | "saas" | "startup" | "agency" | "portfolio" | "ecommerce" | "restaurant" | "hospitality"
  | "finance" | "dashboard" | "marketplace" | "booking" | "editorial" | "landing" | "webapp";

/** Ordered: first match wins; specific before generic. */
const CATEGORY_RULES: Array<{ id: SiteCategory; re: RegExp; topics: DesignTopic[]; defaults: string[] }> = [
  { id: "dashboard", re: /\b(dashboard|admin panel|analytics|crm|back ?office)\b/i, topics: ["dashboards", "tables", "navigation", "cards"], defaults: ["Neutral surfaces, one accent, dense data typography."] },
  { id: "marketplace", re: /\b(marketplace|airbnb|etsy|listings?|two.?sided)\b/i, topics: ["cards", "grid", "imagery", "forms"], defaults: ["Search-first header; listing cards with image, title, price, rating."] },
  { id: "booking", re: /\b(booking|reservation|appointment|schedul)\b/i, topics: ["forms", "cards", "buttons"], defaults: ["Clear date/time selection; one persistent book action."] },
  { id: "ecommerce", re: /\b(e-?commerce|shop|store|products?|cart|checkout)\b/i, topics: ["cards", "grid", "imagery", "buttons"], defaults: ["Product imagery dominates; price and add-to-cart always visible."] },
  { id: "restaurant", re: /\b(restaurant|cafe|coffee|bakery|bistro|bar|menu|food)\b/i, topics: ["imagery", "typography", "sections"], defaults: ["Warm, appetite-led photography; menu readable at a glance."] },
  { id: "hospitality", re: /\b(hotel|resort|villa|lodge|travel|hospitality|spa)\b/i, topics: ["imagery", "hero", "typography"], defaults: ["Immersive imagery, generous whitespace, refined serif or display type."] },
  { id: "finance", re: /\b(finance|fintech|bank|invest|crypto|wallet|payments?|insurance)\b/i, topics: ["color", "tables", "accessibility"], defaults: ["Trust-first: restrained palette, precise numerals, strong contrast."] },
  { id: "agency", re: /\b(agency|studio|consultan)\b/i, topics: ["typography", "composition", "imagery"], defaults: ["Confident editorial type, case-study led."] },
  { id: "portfolio", re: /\b(portfolio|personal site|my work|resume|cv)\b/i, topics: ["grid", "imagery", "typography"], defaults: ["Work is the hero; minimal chrome."] },
  { id: "editorial", re: /\b(blog|magazine|news|editorial|articles?|publication)\b/i, topics: ["typography", "type_hierarchy", "containers"], defaults: ["Readable measure (60–75ch), strong headline hierarchy."] },
  { id: "saas", re: /\b(saas|software|platform|api|b2b|tool for)\b/i, topics: ["hero", "sections", "buttons", "cards"], defaults: ["Product-led hero with real UI visual; crisp sans type."] },
  { id: "startup", re: /\b(startup|launch|waitlist|early access)\b/i, topics: ["hero", "buttons", "sections"], defaults: ["Single clear promise and one conversion action."] },
  { id: "webapp", re: /\b(web ?app|application|tracker|todo|planner|manager|portal)\b/i, topics: ["layout", "forms", "navigation", "buttons"], defaults: ["App shell over marketing; functional density."] },
  { id: "landing", re: /\b(landing page|one.?page|homepage|website|site)\b/i, topics: ["hero", "sections", "composition"], defaults: ["Tight narrative; only the sections the request calls for."] },
];

const BASE_TOPICS: DesignTopic[] = ["typography", "color", "spacing", "responsive", "accessibility", "visual_hierarchy"];
const REDESIGN = /\b(re-?design|new look|revamp|overhaul|restyle|rebrand|change the (whole )?(design|style|theme|look)|make (it|the (site|app)) look (completely )?different)\b/i;
/** User-stated design choices that override category defaults. */
const USER_DESIGN_STATEMENT = /\b(dark|light|minimal|bold|playful|serif|sans|brutalist|colou?rful|monochrome|pastel|neon|#[0-9a-f]{3,6}|(red|blue|green|black|white|orange|purple|pink|yellow|gold|navy|teal) (theme|palette|accent|background))\b/i;

export function detectSiteCategory(request: string): SiteCategory | null {
  return CATEGORY_RULES.find((c) => c.re.test(request))?.id ?? null;
}

export interface DesignKnowledgeSelection {
  mode: "initial" | "redesign" | "edit";
  category: SiteCategory | null;
  topics: DesignTopic[];
  userOverrides: boolean;
  /** When true the project's existing design language is authoritative. */
  preserveExisting: boolean;
}

export function selectDesignKnowledge(args: { request: string; isInitial: boolean; hasExistingDesign: boolean }): DesignKnowledgeSelection {
  const r = args.request || "";
  const named = (Object.keys(DESIGN_KNOWLEDGE) as DesignTopic[]).filter((t) => DESIGN_KNOWLEDGE[t].triggers.test(r));
  const redesign = !args.isInitial && REDESIGN.test(r);
  const mode: DesignKnowledgeSelection["mode"] = args.isInitial || !args.hasExistingDesign ? "initial" : redesign ? "redesign" : "edit";
  const category = mode === "edit" ? null : detectSiteCategory(r);
  const catTopics = category ? CATEGORY_RULES.find((c) => c.id === category)!.topics : [];
  const topics = mode === "edit" ? named : [...new Set([...BASE_TOPICS, ...catTopics, ...named])];
  return { mode, category, topics, userOverrides: USER_DESIGN_STATEMENT.test(r), preserveExisting: mode === "edit" };
}

export function renderDesignKnowledge(sel: DesignKnowledgeSelection): string {
  if (!sel.topics.length && !sel.category) return "";
  const out: string[] = ["\n## DESIGN KNOWLEDGE (craft reference — not the project's design)"];
  if (sel.preserveExisting) {
    out.push("Precedence: the user's request > PROJECT DESIGN LANGUAGE above > this reference. Use these rules only to execute the requested change inside the existing system — reuse its fonts, tokens, radius, spacing and components. Do not restyle, rewrite or re-section anything outside the requested change.");
  } else {
    out.push(`Precedence: the user's request > ${sel.mode === "redesign" ? "this reference > the old design" : "category defaults > general craft"}. Keep one coherent system across every page and component.`);
    if (sel.category) {
      const c = CATEGORY_RULES.find((x) => x.id === sel.category)!;
      out.push(`Recognised intent: ${sel.category}. Default direction${sel.userOverrides ? " (user's stated style wins where it differs)" : ""}: ${c.defaults.join(" ")}`);
    }
    out.push("Build only the pages and sections the user requested; do not add About/Pricing/Contact or filler sections unless asked.");
  }
  for (const t of sel.topics) out.push(`- ${t}: ${DESIGN_KNOWLEDGE[t].rules.join(" ")}`);
  return out.join("\n") + "\n";
}
