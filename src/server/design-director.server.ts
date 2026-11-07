/**
 * Layer 4 — Design Director Pass.
 *
 * Before the builder model writes any code, a tiny "design director" picks a
 * concrete visual direction for the app: a named vibe, a typography pairing,
 * a palette mood, a layout density, a motion level, and 2–4 distinctive
 * design moves.
 *
 * Why this exists: without an explicit point of view, language models default
 * to the same generic AI aesthetic on every project (Inter + purple gradient
 * + evenly-spaced cards). One up-front decision, surfaced in the prompt,
 * is the single highest-leverage way to make Kimble's output feel intentional.
 *
 * Behavior:
 * - Runs ONLY on the initial build (turn 1). Subsequent turns inherit the
 *   direction from project_memory so the look stays consistent.
 * - Honors existing project_memory (audience, tone, palette_intent, …) so
 *   the vibe builds on what we already know about the user.
 * - Best-effort: any failure returns null and generation proceeds with the
 *   model's default taste. We never block a build on the director.
 * - Persists the chosen direction into project_memory under the
 *   "design_direction" key so future turns can read it cheaply.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { MemoryEntry } from "@/server/project-memory.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { resolveDefaultPackage } from "@/server/design-systems/authority";
import {
  pickTemplateForBrief,
  renderTemplatePlanBlock,
  type TemplateKey,
} from "@/server/templates.server";
import {
  classifyAppShape,
  type BusinessDomain,
  type ShapeCategory,
} from "@/lib/app-shape-classifier";

const DIRECTOR_MODEL = "google/gemini-3.8-flash";

/**
 * Part B — domain-aware font defaults.
 *
 * Surfaced as a SUGGESTED pairing in the director prompt and used as a
 * substitution fallback when the model returns a generic Inter+Inter (or
 * display == body). Never overrides an opinionated, distinctive choice —
 * only nudges defaults so every build ships with a defensible type system.
 */
const DOMAIN_FONT_DEFAULTS: Partial<Record<BusinessDomain, { display: string; body: string }>> = {
  crm: { display: "Plus Jakarta Sans", body: "Inter" },
  helpdesk: { display: "Plus Jakarta Sans", body: "Inter" },
  hris: { display: "Plus Jakarta Sans", body: "Inter" },
  pm: { display: "Geist", body: "Inter" },
  ats: { display: "Plus Jakarta Sans", body: "Inter" },
  billing: { display: "Inter Tight", body: "Inter" },
  analytics: { display: "Space Grotesk", body: "Inter" },
  lms: { display: "Fraunces", body: "Inter" },
  cms: { display: "Instrument Serif", body: "Inter" },
  inventory: { display: "Space Grotesk", body: "Inter" },
  "email-marketing": { display: "Bricolage Grotesque", body: "Inter" },
  scheduling: { display: "Plus Jakarta Sans", body: "Inter" },
};

const CATEGORY_FONT_DEFAULTS: Partial<Record<ShapeCategory, { display: string; body: string }>> = {
  fintech: { display: "Inter Tight", body: "Inter" },
  crypto: { display: "Space Grotesk", body: "JetBrains Mono" },
  saas: { display: "Plus Jakarta Sans", body: "Inter" },
  "ai-tool": { display: "Geist", body: "Inter" },
  ecommerce: { display: "Bricolage Grotesque", body: "Inter" },
  marketplace: { display: "Space Grotesk", body: "Inter" },
  social: { display: "Bricolage Grotesque", body: "Inter" },
  messaging: { display: "Plus Jakarta Sans", body: "Inter" },
  booking: { display: "Fraunces", body: "Inter" },
  content: { display: "Fraunces", body: "Inter" },
  creator: { display: "Instrument Serif", body: "Inter" },
  "internal-tool": { display: "Geist", body: "Inter" },
  directory: { display: "Plus Jakarta Sans", body: "Inter" },
  "local-business": { display: "Fraunces", body: "Inter" },
  newsletter: { display: "Instrument Serif", body: "Inter" },
  consultancy: { display: "Fraunces", body: "Inter" },
  "real-estate": { display: "Cormorant Garamond", body: "Inter" },
  fitness: { display: "Unbounded", body: "Inter" },
  restaurant: { display: "Fraunces", body: "Inter" },
  game: { display: "Unbounded", body: "Inter" },
};

function pickFontDefault(
  brief: string,
): { display: string; body: string; reason: string } | null {
  try {
    const shape = classifyAppShape(brief);
    if (shape.businessDomain && DOMAIN_FONT_DEFAULTS[shape.businessDomain]) {
      const p = DOMAIN_FONT_DEFAULTS[shape.businessDomain]!;
      return { ...p, reason: `domain=${shape.businessDomain}` };
    }
    if (CATEGORY_FONT_DEFAULTS[shape.category]) {
      const p = CATEGORY_FONT_DEFAULTS[shape.category]!;
      return { ...p, reason: `category=${shape.category}` };
    }
  } catch {
    /* ignore */
  }
  return null;
}

const GENERIC_FONTS = new Set(["inter", "roboto", "system-ui", "sans-serif", "arial", "poppins"]);

export type MotionIntensity = "still" | "subtle" | "expressive" | "cinematic";

/**
 * Named design recipes. Each recipe describes the composition and motion
 * language (photography, type, spacing, `@/components/motion` reveals and,
 * for cinematic, Awwwards-layer primitives). The model can pick a recipe by key; if it doesn't, we infer
 * one from app shape via `pickFxRecipe()` so every build gets a defensible
 * starting palette instead of inventing effects ad-hoc.
 */
export type FxRecipe =
  | "vivid-color"
  | "modern-saas"
  | "agency-portfolio"
  | "cyberpunk-crypto"
  | "ai-product"
  | "playful-consumer"
  | "luxury-brand"
  | "data-dashboard"
  | "awwwards-3d";

export type DesignDirection = {
  /** Short human-readable label, e.g. "warm-editorial", "brutalist-mono", "soft-glass". */
  vibe: string;
  /** One-line justification — why THIS vibe fits THIS brief. */
  rationale: string;
  /** Display font family hint (e.g. "Fraunces", "Space Grotesk"). */
  display_font: string;
  /** Body font family hint (e.g. "Inter", "IBM Plex Sans"). NEVER == display_font. */
  body_font: string;
  /** Color mood phrase, e.g. "burnt-orange + cream, deep navy accents". */
  palette_mood: string;
  /** "minimal" | "balanced" | "dense" — how packed the layouts should feel. */
  density: "minimal" | "balanced" | "dense";
  /**
   * Motion intensity ladder.
   *   still       — zero motion primitives, type only.
   *   subtle      — FadeIn / SlideUp / BlurFade on key sections.
   *   expressive  — Stagger + SplitText + gentle Parallax.
   *   cinematic   — Awwwards layer: Lenis smooth-scroll + GSAP ScrollTrigger
   *                 reveals + optional R3F hero scene + view transitions.
   */
  motion: MotionIntensity;
  /** Named FX bundle to compose. Inferred from app shape if model omits. */
  fx_recipe?: FxRecipe;
  /** 2–4 concrete design moves to commit to (e.g. "asymmetric hero", "oversized numerals"). */
  design_moves: string[];
  /**
   * Legacy only: old records carry a theme key. Colours and fonts now come
   * from the design system package; this field is ignored.
   */
  theme?: string;
  /** Hidden template key — drives the route + section plan. Never surfaced to the user. */
  template?: TemplateKey | null;
};

/**
 * Recipe → expanded prompt block. Each entry names exact component imports
 * so the model doesn't have to remember the FX catalog by heart.
 */
const FX_RECIPE_DETAILS: Record<FxRecipe, string> = {
  "vivid-color":
    "Confident colour-block sections (full-bleed brand-hue panel alternating with a light tint), bold display type, real photography, quiet FadeIn reveals. No gradient meshes, glow cards or shimmer buttons.",
  "modern-saas":
    "Clean split hero: headline, one sentence, one filled <Button size=\"lg\"> plus optional outline button; real product screenshot on a plain surface. No floating decorative cards, no mesh washes, no beams. FadeIn on major sections only.",
  "agency-portfolio":
    "Full-bleed photographic hero, plain image-led project tiles (picture, title, one meta line), generous white space, quiet FadeIn/Stagger reveals only. No marquees, tilt, glow or magnetic effects — the photographs carry the page.",
  "cyberpunk-crypto":
    "Dark solid surfaces, mono accents for numbers, crisp hairline borders, one saturated accent. No retro grids, meteors, rainbow or shimmer buttons.",
  "ai-product":
    "Plain product surface as the hero visual (the real chat/workspace UI), clear capability rows with icon + title + sentence, solid primary button. No beams, sparkles or gradient text.",
  "playful-consumer":
    "Warm colour blocks, rounded-but-restrained cards, friendly display type, real photography, gentle FadeIn. No marquees, flickering grids, ripples or rotating words.",
  "luxury-brand":
    "Oversized serif headlines, slow subtle reveals on product imagery, generous white space, solid neutral surfaces. No beams, grids, noise or shiny text — silence is luxury.",
  "data-dashboard":
    "Plain surfaces, KPI tiles with CountUp, FadeIn on cards, no background patterns. Density over flash.",
  "awwwards-3d":
    "R3F HeroSphere or SplineEmbed as hero centerpiece, LenisProvider wrapping the app, useScrollScene for pinned reveal sequences, GSAP ScrollTrigger horizontal scroll for showcase, SplitText hero, view transitions on route changes.",
};

/**
 * Deterministic fallback recipe picker — runs when the director model omits
 * `fx_recipe`. Reads the app shape so each domain gets a defensible default.
 */
function pickFxRecipe(brief: string, motion: MotionIntensity): FxRecipe {
  if (motion === "cinematic") return "awwwards-3d";
  try {
    const shape = classifyAppShape(brief);
    switch (shape.category) {
      case "crypto":
        return "cyberpunk-crypto";
      case "ai-tool":
        return "ai-product";
      case "saas":
      case "internal-tool":
        return "modern-saas";
      case "creator":
      case "content":
      case "newsletter":
      case "consultancy":
        return "vivid-color";
      case "real-estate":
      case "restaurant":
      case "local-business":
        return "luxury-brand";
      case "ecommerce":
      case "marketplace":
        return "playful-consumer";
      case "fitness":
      case "game":
      case "social":
        return "playful-consumer";
      default:
        // Unknown shape → bias toward expressive recipes over the most
        // restrained one. "modern-saas" used to be the catch-all and that's
        // exactly why generic B2B briefs shipped flat (the PipelinePilot
        // failure). agency-portfolio carries more visual conviction.
        return motion === "still" ? "vivid-color" : "agency-portfolio";
    }
  } catch {
    return "agency-portfolio";
  }
}

/** A category-specific floor for timeouts and unconfigured design models. */
export function fallbackDesignDirection(brief: string, seed?: string): DesignDirection {
  const cleanBrief = (brief ?? "").trim();
  const pkgFonts = resolveDefaultPackage()?.pkg.meta.fonts ?? [];
  const font = pickFontDefault(cleanBrief) ?? {
    display: pkgFonts[0] ?? "system-ui",
    body: pkgFonts[1] ?? pkgFonts[0] ?? "system-ui",
    reason: "package",
  };
  const shape = classifyAppShape(cleanBrief);
  const appLike = ["fintech", "crypto", "saas", "internal-tool", "marketplace"].includes(
    shape.category,
  );
  const movesByCategory: Partial<Record<ShapeCategory, string[]>> = {
    fintech: [
      "account balance and cash-flow story above the fold",
      "mixed-span KPI composition with tabular numerals and trend context",
      "dense transaction surface with status, counterparty and meaningful actions",
    ],
    restaurant: [
      "full-bleed food or venue photography as the opening composition",
      "editorial menu storytelling with chef, provenance and signature dishes",
      "reservation details and service atmosphere woven through the page",
    ],
    booking: [
      "availability and trust cues visible before the first scroll",
      "date, guest and price choices composed as one clear booking journey",
      "destination imagery paired with useful availability metadata",
    ],
    marketplace: [
      "merchandise-led opening with search and category discovery",
      "varied listing rhythm with real imagery, price and seller trust cues",
      "saved, recent and recommended states that make the marketplace feel active",
    ],
  };
  const designMoves = movesByCategory[shape.category] ?? [
    "one unmistakable product-specific visual moment above the fold",
    "asymmetric hierarchy with one dominant surface and supporting evidence",
    "complete content states using believable domain data rather than filler",
  ];
  const motion: MotionIntensity = shape.category === "restaurant" ? "expressive" : "subtle";

  return {
    vibe: `${shape.category}-direction`,
    rationale: `A category-specific ${shape.category} direction that foregrounds the product's real content and primary journey.`,
    display_font: font.display,
    body_font: font.body,
    palette_mood: "Set by the selected design system package.",
    density: appLike ? "dense" : "balanced",
    motion,
    fx_recipe: pickFxRecipe(cleanBrief, motion),
    design_moves: designMoves,
    template: pickTemplateForBrief(cleanBrief, seed ?? cleanBrief),
  };
}

const DIRECTOR_SYSTEM = `You are Kimble's Design Director. Before the builder writes any code, you commit to ONE bold, specific visual direction for the app.

You are NOT a generic stylist. You reject defaults: no Inter+purple-gradient SaaS, no evenly-spaced rounded cards on white, no "modern minimal" without conviction. Pick a direction with a real point of view.

Inputs:
- The user's brief (their latest message, possibly broken English — read past surface form to intent).
- Existing project memory (audience, tone, palette intent, etc.) — honor it, don't override it.

Output a SINGLE call to the "set_design_direction" tool with:
- vibe: a short kebab-case label that names the aesthetic (examples: "warm-editorial", "brutalist-mono", "soft-glass-pastel", "retro-arcade", "art-deco-luxe", "organic-handcrafted", "swiss-grid", "neo-brutalist", "playful-maximalist", "moody-cinematic"). DO NOT pick "modern-minimal" or "clean-saas" — they are banned defaults.
- rationale: ONE sentence explaining why this vibe fits this brief and audience.
- display_font + body_font: a real, distinctive pairing. Avoid Inter/Poppins as the display font. Body can be a clean workhorse (Inter is OK as body if display is distinctive). Examples of good display choices: Fraunces, Space Grotesk, Playfair Display, IBM Plex Mono, Instrument Serif, Bricolage Grotesque, DM Serif Display, Unbounded, Cormorant Garamond, JetBrains Mono.
- palette_mood: a sentence describing the actual hues, not "modern colors". E.g. "warm cream background, burnt sienna primary, ink-black text, sage accents".
- density: minimal / balanced / dense. Match the audience: consumer landing → minimal/balanced; data dashboards → dense; editorial → balanced with generous white space.
- motion: still / subtle / expressive / cinematic. Default subtle. Use expressive when the brand calls for energy. Use cinematic ONLY for agency / portfolio / showcase / luxury sites where Awwwards-grade scroll choreography is the point — it pulls in Lenis smooth-scroll, GSAP ScrollTrigger, and optionally a R3F 3D hero, which is overkill for SaaS dashboards or internal tools.
- fx_recipe: name the FX bundle this app should compose. Pick ONE of: vivid-color, modern-saas, agency-portfolio, cyberpunk-crypto, ai-product, playful-consumer, luxury-brand, data-dashboard, awwwards-3d. The recipe sets the composition and motion language. If motion=cinematic you MUST pick fx_recipe=awwwards-3d.
- design_moves: 2–4 SHORT, concrete moves that make this app unforgettable. Examples: "oversized numerals as section markers", "asymmetric hero with off-center photo", "thin underline accents instead of borders", "monospace metadata under serif headings". NEVER "use cards" or "use a grid" — those aren't moves.

Calibration — two recent Kimble outputs, same builder, very different results:
✅ GOOD ("Flowy", period tracker): magenta brand-dot logo + wordmark, pink eyebrow pill, bold sans display H1 with marker-highlight on one word, 3-line subhead in muted ink, filled pink pill primary CTA + outlined pill secondary, real hero photo of a person with a floating "5 Days to Flow" status card overlapping the photo. Feels like a real product.
❌ BAD ("PipelinePilot", SaaS CRM): generic sparkle icon, "Streamline Your Sales" rendered as a body-sized eyebrow with no real H1, body paragraph centered in dead space, two bare text+arrow "Start Your Free Trial →" / "Learn More" links with no button chrome, DotPattern occupying ~70% of the fold, dashboard mockup buried below. Looks like a placeholder.
The difference is composition discipline, not the kit. SaaS briefs deserve Flowy-tier execution too — pick vibes and moves that demand it.

Anti-slop rules — these are hard constraints on the direction you commit to:
1. No symmetric card triplets as the primary rhythm. If a section has three peers, break it: change one card's span, offset it vertically, or make the first one a full-width statement.
2. Colour with intent. One primary hue for actions and key marks, optionally one supporting hue, plus neutrals. Quiet, neutral, cream and editorial palettes are welcome when they fit the business. Never a stock purple-to-indigo gradient.
2b. Contrast is non-negotiable: body text ≥ 4.5:1 against its surface, large display text ≥ 3:1, and every filled button's label must contrast against its own fill (never a light accent with white text). If a hue is too light for white text, darken the fill instead of lightening the text.
2c. Prefer directions modern studios actually ship: quiet editorial, warm natural, crisp monochrome, confident colour-block, technical. No vivid-gradient, neon or glassy directions.
3. No purple/indigo-on-white gradient heroes, no glowing blurred blobs behind centered text, no floating sparkle icon as the hero graphic.
4. Type must have a scale jump: display headings at least 3x the body size, with tight negative tracking. Even a "minimal" direction commits to one oversized element per screen.
5. Motion is one register applied consistently — pick a single easing and duration family. Never mix a bouncy spring with a slow cinematic fade in the same app.
6. Every section needs a reason to look different from the one above it. Alternating background tone alone is not a reason; change the layout axis, the density, or the type treatment.

Be DECISIVE. One direction, executed with conviction. No hedging.`;

const DIRECTOR_TOOL = {
  type: "function" as const,
  function: {
    name: "set_design_direction",
    description: "Commit to one bold visual direction for this app.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        vibe: { type: "string" },
        rationale: { type: "string" },
        display_font: { type: "string" },
        body_font: { type: "string" },
        palette_mood: { type: "string" },
        density: { type: "string", enum: ["minimal", "balanced", "dense"] },
        motion: { type: "string", enum: ["still", "subtle", "expressive", "cinematic"] },
        fx_recipe: {
          type: "string",
          enum: [
            "vivid-color",
            "modern-saas",
            "agency-portfolio",
            "cyberpunk-crypto",
            "ai-product",
            "playful-consumer",
            "luxury-brand",
            "data-dashboard",
            "awwwards-3d",
          ],
        },
        design_moves: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string" },
        },
      },
      required: [
        "vibe",
        "rationale",
        "display_font",
        "body_font",
        "palette_mood",
        "density",
        "motion",
        "design_moves",
      ],
    },
  },
};

/**
 * Render a Design Direction as a prompt block.
 *
 * `detail: "compact"` (small, non-structural edits) injects only the parts an
 * edit must respect — vibe, typography, palette, density and the motion rule —
 * and drops the FX catalog, theme token table and template plan. Those are
 * scaffolding instructions that only matter when new surface is being built,
 * and they are by far the largest part of this block. Keeping them on every
 * copy tweak was pure input-token cost with no effect on the output.
 */
export function renderDesignDirectionBlock(
  d: DesignDirection,
  opts?: { detail?: "full" | "compact"; packageOwnsVisuals?: boolean },
): string {
  const compact = opts?.detail === "compact";
  const pkg = opts?.packageOwnsVisuals === true;
  const moves = d.design_moves.map((m) => `  - ${m}`).join("\n");
  const templateBlock = !compact && d.template ? renderTemplatePlanBlock(d.template) : "";
  if (compact) {
    return (
      `\n\n### Design Direction (already committed for this project — keep it)\n` +
      `- vibe: ${d.vibe}\n` +
      (pkg
        ? `- colours & fonts: owned by the SELECTED DESIGN SYSTEM. Use its tokens; never add raw colours or font links.\n`
        : `- typography: ${d.display_font} (display) + ${d.body_font} (body). Do not swap these.\n` +
          `- palette mood: ${d.palette_mood}. Use the existing oklch tokens in src/styles.css; do not introduce new raw colors.\n`) +
      `- density: ${d.density}\n` +
      `- motion: ${d.motion}. Match the motion level already used on the page; do not add new motion primitives for a small edit.\n` +
      `- design moves to preserve:\n${moves}\n`
    );
  }
  return (
    `\n\n### Design Direction (committed before this build — execute it with conviction)\n` +
    `- vibe: ${d.vibe}\n` +
    `- rationale: ${d.rationale}\n` +
    (pkg
      ? `- colours & fonts: owned by the SELECTED DESIGN SYSTEM (tokens and font links are installed by Kimble). Do not write your own palette, :root colour values or font links.\n`
      : `- typography: ${d.display_font} (display) + ${d.body_font} (body). Load both via Google Fonts in index.html and set them on --font-sans / a display utility in src/styles.css. NEVER fall back to the default system stack.\n` +
        `- palette mood: ${d.palette_mood}. Translate this into oklch tokens in src/styles.css (background, foreground, primary, accent, muted). DO NOT use stock purple gradients on white.\n`) +
    `- density: ${d.density}\n` +
    `- motion: ${d.motion}\n` +
    `- motion primitives (\`@/components/motion\`): FadeIn, SlideUp, Stagger + StaggerItem, Reveal, Parallax, SplitText, CountUp, BlurFade. ` +
      (d.motion === "still"
        ? `motion=still → do NOT import these. Type and color do the work.`
        : d.motion === "subtle"
          ? `motion=subtle → FadeIn / SlideUp / BlurFade on the hero and major sections only. No SplitText, no Magnetic.`
          : d.motion === "expressive"
            ? `motion=expressive → Stagger + SplitText on the hero, gentle Parallax on hero media. Layer 2-3 across the page, not on every element.`
            : `motion=cinematic → wrap the app in LenisProvider (\`@/components/scroll/lenis-provider\`). Use useScrollScene (\`@/hooks/use-scroll-scene\`) for pinned reveal sequences and useHorizontalScroll for the showcase strip. Hero: R3F HeroSphere (\`@/components/three/hero-sphere\`) OR SplineEmbed. SplitText on the headline. View transitions via \`@/lib/view-transitions\` on route changes. canvas-confetti via \`@/lib/confetti\` on success moments.`) +
      `\n` +
    `- fx recipe: ${d.fx_recipe ?? "(unset)"} — ${d.fx_recipe ? FX_RECIPE_DETAILS[d.fx_recipe] : "no specific recipe"}\n` +
    `- there is no \`@/components/fx\` folder and no marquee or gradient-text component: never import them or hand-build glowing/shimmer buttons, scrolling strips or colour-fade text. Photography, type and spacing carry the page.
` +
    `- design moves to land:\n${moves}\n` +
    `Do not silently revert to a generic "clean SaaS" look. If a kit component feels too neutral for the vibe, restyle it via className overrides while keeping the component itself.\n` +
    templateBlock
  );
}

/** Try to parse a previously-saved direction from project_memory. */
export function readDirectionFromMemory(entries: MemoryEntry[]): DesignDirection | null {
  const row = entries.find((e) => e.key === "design_direction");
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === "object" && typeof parsed.vibe === "string") {
      return parsed as DesignDirection;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Persist a direction back to project_memory so future turns can reuse it. */
async function saveDirectionToMemory(args: {
  jwt: string;
  projectId: string;
  direction: DesignDirection;
}): Promise<void> {
  const { jwt, projectId, direction } = args;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;
  try {
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Preserve the complete direction. Truncating this JSON made the memory
    // unparsable whenever richer design moves pushed it past the old cap,
    // silently discarding the project's visual contract on later edits.
    await supabase.from("project_memory").upsert(
      {
        project_id: projectId,
        key: "design_direction",
        value: JSON.stringify(direction).slice(0, 4000),
      },
      { onConflict: "project_id,key" },
    );
  } catch (e) {
    console.warn("[design-director] save threw:", e);
  }
}

/**
 * Pick a design direction for this build.
 *
 * - If memory already has one (subsequent turns), return it as-is.
 * - Otherwise call the director model. On any failure, return null and let
 *   the build proceed with the model's default taste.
 */
export async function pickDesignDirection(args: {
  jwt: string;
  projectId: string | undefined;
  brief: string;
  memoryEntries: MemoryEntry[];
}): Promise<DesignDirection | null> {
  const cached = readDirectionFromMemory(args.memoryEntries);
  if (cached) return cached;

  const trimmedBrief = (args.brief ?? "").trim().slice(0, 1500);
  // Seed for tie-breaking theme/template picks. Per-project, so two different
  // projects with similarly generic briefs don't land on an identical design
  // system, while re-running a turn on one project stays consistent.
  const designSeed = args.projectId ?? trimmedBrief;
  if (trimmedBrief.length < 4) return null;
  const fallback = () => fallbackDesignDirection(trimmedBrief, designSeed);
  const persist = (picked: DesignDirection): DesignDirection => {
    if (args.projectId) {
      void saveDirectionToMemory({
        jwt: args.jwt,
        projectId: args.projectId,
        direction: picked,
      }).catch(() => {});
    }
    return picked;
  };
  if (!process.env.LOVABLE_API_KEY) {
    return persist(fallback());
  }

  // Compact memory context — only the keys that actually inform aesthetic choices.
  const relevantKeys = new Set([
    "app_kind",
    "audience",
    "tone",
    "palette_intent",
    "typography_intent",
    "must_have",
    "dont_do",
    "name",
  ]);
  const memContext = args.memoryEntries
    .filter((e) => relevantKeys.has(e.key))
    .map((e) => `- ${e.key}: ${e.value}`)
    .join("\n");

  // Part B — pre-compute a domain/category font default. Surfaced as a
  // SUGGESTION the model can accept or override with something better.
  const fontDefault = pickFontDefault(trimmedBrief);
  const fontHint = fontDefault
    ? `\nSUGGESTED TYPOGRAPHY (defensible default for this ${fontDefault.reason}; override only if you have a more distinctive pairing):\n- display: ${fontDefault.display}\n- body: ${fontDefault.body}\n`
    : "";

  const userPrompt =
    `BRIEF (user's words):\n"""${trimmedBrief}"""\n\n` +
    `WHAT WE KNOW ABOUT THE PROJECT:\n${memContext || "(nothing yet)"}\n` +
    fontHint +
    `\nPick one bold direction and call set_design_direction now.`;

  /**
   * Deterministic fallback direction.
   *
   * Returning `null` when the model is slow was the single biggest cause of
   * "the app looks plain": with no direction, no font pair reaches the
   * prompt, `styles.css` gets no `--font-display`, and the build renders in
   * system sans with default taste. A picked-by-rule direction is always
   * better than no direction, so a timeout now degrades instead of failing.
   */
  let direction: DesignDirection | null = null;
  try {
    // SOFT TIMEOUT (18s). The director must not block the whole build — that
    // burns the worker's CPU/wall budget and returns an empty response. But
    // on timeout we now fall back to a deterministic direction rather than
    // shipping with no design system at all.
    const resp = await aiChatCompletions({
      feature: "design",
      body: {
        model: DIRECTOR_MODEL,

        messages: [
          { role: "system", content: DIRECTOR_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [DIRECTOR_TOOL],
        tool_choice: { type: "function", function: { name: "set_design_direction" } },
      },
      signal: AbortSignal.timeout(18_000),
    });
    if (!resp.ok) {
      console.warn("[design-director] http error", resp.status, "— using deterministic direction");
      return persist(fallback());
    }
    // Read the reply body exactly once; a failed read falls back cleanly.
    let raw: string;
    try {
      raw = await resp.text();
    } catch (e) {
      console.warn("[design-director] body read failed — using deterministic direction", e);
      return persist(fallback());
    }
    const json = JSON.parse(raw || "{}") as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return persist(fallback());
    const parsed = JSON.parse(argsStr) as DesignDirection;
    // Validate the bare minimum so a malformed call can't poison the prompt.
    if (
      !parsed?.vibe ||
      !parsed?.display_font ||
      !parsed?.body_font ||
      !parsed?.palette_mood ||
      !Array.isArray(parsed.design_moves) ||
      parsed.design_moves.length < 2
    ) {
      return persist(fallback());
    }
    // Part B — substitute generic font choices with the domain default.
    // Triggers when the model returned display == body, both generic, or
    // (display, body) ∈ generic set with no distinctive choice.
    if (fontDefault) {
      const dlow = parsed.display_font.trim().toLowerCase();
      const blow = parsed.body_font.trim().toLowerCase();
      const sameOrGeneric =
        dlow === blow || (GENERIC_FONTS.has(dlow) && GENERIC_FONTS.has(blow));
      if (sameOrGeneric) {
        parsed.display_font = fontDefault.display;
        parsed.body_font = fontDefault.body;
      }
    }
    // Colours and fonts belong to the design system package; any theme key
    // the model returns is dropped.
    delete parsed.theme;
    // Workstream C2: assign a hidden template key from the brief so the
    // builder model scaffolds the right routes/sections instead of
    // defaulting to a generic landing page.
    if (parsed.template === undefined) {
      parsed.template = pickTemplateForBrief(trimmedBrief, designSeed);
    }
    // Phase 18 — fx_recipe fallback + cinematic ↔ awwwards-3d coherence.
    // If the model omitted fx_recipe (or picked one that contradicts a
    // cinematic motion setting), pick one deterministically from app shape.
    const VALID_RECIPES: ReadonlySet<FxRecipe> = new Set<FxRecipe>([
      "vivid-color", "modern-saas", "agency-portfolio", "cyberpunk-crypto",
      "ai-product", "playful-consumer", "luxury-brand", "data-dashboard", "awwwards-3d",
    ]);
    if (!parsed.fx_recipe || !VALID_RECIPES.has(parsed.fx_recipe)) {
      parsed.fx_recipe = pickFxRecipe(trimmedBrief, parsed.motion);
    }
    if (parsed.motion === "cinematic" && parsed.fx_recipe !== "awwwards-3d") {
      parsed.fx_recipe = "awwwards-3d";
    }
    direction = parsed;
  } catch (e) {
    console.warn("[design-director] threw:", e, "— using deterministic direction");
    return persist(fallback());
  }

  // Best-effort persistence — never blocks.
  if (direction && args.projectId) {
    void saveDirectionToMemory({
      jwt: args.jwt,
      projectId: args.projectId,
      direction,
    }).catch(() => {});
  }
  return direction;
}
