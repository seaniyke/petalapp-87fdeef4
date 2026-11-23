/**
 * Product personalities — five distinct identities for software products
 * (SaaS, platforms, dashboards, AI tools, fintech), so two people asking for
 * "a SaaS" never get the same site.
 *
 * Each personality fixes a matching layout + look + accent and adds a few
 * positive composition moves. Pure and deterministic: explicit reference
 * words in the brief win ("like Linear", "like Notion", …); otherwise the
 * project seed picks one, so one project always keeps its personality.
 * Applies only to software-product briefs; never adds pages or sections.
 */
import { styleSeedHash, type LayoutArchetypeId, type PublicLookSlug } from "./style-catalog";

export const PRODUCT_PERSONALITY_IDS = ["terminal", "editorial", "kinetic", "enterprise", "friendly"] as const;
export type ProductPersonalityId = (typeof PRODUCT_PERSONALITY_IDS)[number];

export interface ProductPersonality {
  id: ProductPersonalityId;
  name: string;
  references: string;
  layout: LayoutArchetypeId;
  look: PublicLookSlug;
  accent: string;
  moves: string[];
}

export const PRODUCT_PERSONALITIES: Record<ProductPersonalityId, ProductPersonality> = {
  terminal: {
    id: "terminal",
    name: "High-utility terminal",
    references: "Linear, Vercel",
    layout: "swiss-minimal",
    look: "brutalist",
    accent: "acid",
    moves: [
      "Show the product working: a real command palette (⌘K), keyboard hints, live log or metrics rows.",
      "Dense, precise information with crisp hairlines; speed and control are the message.",
    ],
  },
  editorial: {
    id: "editorial",
    name: "Editorial, thoughtful product",
    references: "Notion, Anthropic, Substack",
    layout: "editorial-magazine",
    look: "haven",
    accent: "sage",
    moves: [
      "Tell the product's story like an essay: large calm headlines, generous reading rhythm, captioned product moments.",
      "Warm, human language and illustrative diagrams instead of feature grids.",
    ],
  },
  kinetic: {
    id: "kinetic",
    name: "Kinetic, interactive product",
    references: "Raycast, Supabase",
    layout: "bento-showcase",
    look: "kinetic",
    accent: "electric",
    moves: [
      "Bento tiles that move: live widgets, cursor spotlight, glowing edges and gentle spring motion.",
      "Let visitors touch the product above the fold — a toggle, a slider or a tiny working demo.",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise and financial platform",
    references: "Stripe, Ramp, Mercury",
    layout: "split-screen",
    look: "meridian",
    accent: "cobalt",
    moves: [
      "Layered frosted surfaces with soft depth; one side tells the value, the other shows a working calculator, dashboard or flow.",
      "Quiet confidence: precise numbers, clear trust signals, no hype.",
    ],
  },
  friendly: {
    id: "friendly",
    name: "Friendly consumer tool",
    references: "Loom, Pitch, Craft",
    layout: "visual-gallery",
    look: "bloom",
    accent: "berry",
    moves: [
      "Warm colour washes, big rounded tappable controls, real people and screenshots in a lively staggered layout.",
      "Conversational copy that sounds like a friend explaining the tool.",
    ],
  },
};

/** Software-product briefs (same vocabulary as the look picker's "product" family). */
export const PRODUCT_BRIEF_RE =
  /\b(saas|dashboard|analytic|developer|fintech|crm|startup|ai (tool|product|platform|app)|admin panel|software|api|devtool|crypto|web3|blockchain|automation)\w*/i;

const EXPLICIT: Array<{ id: ProductPersonalityId; re: RegExp }> = [
  { id: "terminal", re: /\b(linear|vercel|terminal|command[- ]line|cli|keyboard[- ]first|hacker)\b/i },
  { id: "editorial", re: /\b(notion|anthropic|substack|editorial|essay|calm|thoughtful)\b/i },
  { id: "kinetic", re: /\b(raycast|supabase|interactive|playful tech|animated|futuristic)\b/i },
  { id: "enterprise", re: /\b(stripe|ramp|mercury|enterprise|institutional|bank[- ]grade|corporate)\b/i },
  { id: "friendly", re: /\b(loom|pitch|craft|friendly|consumer|for everyone|beginner)\b/i },
];

/** The personality for a brief, or null when it is not a software product. */
export function pickProductPersonality(brief: string | null | undefined, seed?: string | null): ProductPersonality | null {
  const text = (brief ?? "").slice(0, 4000);
  if (!PRODUCT_BRIEF_RE.test(text)) return null;
  const explicit = EXPLICIT.find((e) => e.re.test(text));
  if (explicit) return PRODUCT_PERSONALITIES[explicit.id];
  if (!seed) return null;
  const id = PRODUCT_PERSONALITY_IDS[styleSeedHash(`personality:${seed}`) % PRODUCT_PERSONALITY_IDS.length]!;
  return PRODUCT_PERSONALITIES[id];
}

/** Prompt block for a committed personality. */
export function renderProductPersonalityBlock(id: string | null | undefined): string {
  const p = id ? PRODUCT_PERSONALITIES[id as ProductPersonalityId] : undefined;
  if (!p) return "";
  return (
    `\n\n### Product personality: ${p.name} (in the spirit of ${p.references})\n` +
    p.moves.map((m) => `- ${m}`).join("\n") +
    `\n- Make this product unmistakably its own: its brand, real product moments and voice lead. Never copy the reference sites; the person's own words win.\n`
  );
}
