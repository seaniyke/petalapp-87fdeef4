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
 * is the single highest-leverage way to make Petal's output feel intentional.
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
import {
  THEMES,
  pickThemeForBrief,
  renderThemeTokensBlock,
  type ThemeKey,
} from "@/server/themes.server";
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

const DIRECTOR_MODEL = "google/gemini-3-flash-preview";

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
  /** "still" | "subtle" | "expressive" — appetite for motion / framer-motion. */
  motion: "still" | "subtle" | "expressive";
  /** 2–4 concrete design moves to commit to (e.g. "asymmetric hero", "oversized numerals"). */
  design_moves: string[];
  /** Hidden theme key — drives concrete oklch tokens. Never surfaced to the user. */
  theme?: ThemeKey;
  /** Hidden template key — drives the route + section plan. Never surfaced to the user. */
  template?: TemplateKey | null;
};

const DIRECTOR_SYSTEM = `You are Petal's Design Director. Before the builder writes any code, you commit to ONE bold, specific visual direction for the app.

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
- motion: still / subtle / expressive. Default subtle. Use expressive only when the brand obviously calls for it.
- design_moves: 2–4 SHORT, concrete moves that make this app unforgettable. Examples: "oversized numerals as section markers", "asymmetric hero with off-center photo", "thin underline accents instead of borders", "pill-shaped CTAs with hard shadow", "monospace metadata under serif headings". NEVER "use cards" or "use a grid" — those aren't moves.

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
        motion: { type: "string", enum: ["still", "subtle", "expressive"] },
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

/** Render a Design Direction as a compact prompt block. */
export function renderDesignDirectionBlock(d: DesignDirection): string {
  const moves = d.design_moves.map((m) => `  - ${m}`).join("\n");
  const themeBlock = d.theme ? renderThemeTokensBlock(d.theme) : "";
  const templateBlock = d.template ? renderTemplatePlanBlock(d.template) : "";
  return (
    `\n\n### Design Direction (committed before this build — execute it with conviction)\n` +
    `- vibe: ${d.vibe}\n` +
    `- rationale: ${d.rationale}\n` +
    `- typography: ${d.display_font} (display) + ${d.body_font} (body). Load both via Google Fonts in index.html and set them on --font-sans / a display utility in src/styles.css. NEVER fall back to the default system stack.\n` +
    `- palette mood: ${d.palette_mood}. Translate this into oklch tokens in src/styles.css (background, foreground, primary, accent, muted). DO NOT use stock purple gradients on white.\n` +
    `- density: ${d.density}\n` +
    `- motion: ${d.motion}${d.motion === "expressive" ? " (use framer-motion for the hero entrance)" : ""}\n` +
    `- design moves to land:\n${moves}\n` +
    `Do not silently revert to a generic "clean SaaS" look. If a kit component feels too neutral for the vibe, restyle it via className overrides while keeping the component itself.\n` +
    themeBlock +
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
    // Stored as compact JSON in the value column. Capped well under 400 chars
    // by the structured shape (short strings + 2-4 short moves).
    await supabase.from("project_memory").upsert(
      {
        project_id: projectId,
        key: "design_direction",
        value: JSON.stringify(direction).slice(0, 400),
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

  if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) return null;

  const trimmedBrief = (args.brief ?? "").trim().slice(0, 1500);
  if (trimmedBrief.length < 4) return null;

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

  let direction: DesignDirection | null = null;
  try {
    // HARD TIMEOUT (8s). The director is a NICE-TO-HAVE pre-stream pass.
    // If the gateway / preview model is slow or hangs, we MUST NOT block the
    // whole build — that causes the worker to hit its CPU/wall budget and
    // return an empty response (status 0 in CF logs → "Something went wrong"
    // in the UI). On timeout we fall through to null and the build proceeds
    // with the model's default taste.
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
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.warn("[design-director] http error", resp.status);
      return null;
    }
    const json = (await resp.json()) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return null;
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
      return null;
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
    // Workstream C1: assign a hidden theme key from the brief if the
    // model didn't pick one. Drives concrete oklch tokens via
    // renderThemeTokensBlock().
    if (!parsed.theme || !(parsed.theme in THEMES)) {
      parsed.theme = pickThemeForBrief(trimmedBrief);
    }
    // Workstream C2: assign a hidden template key from the brief so the
    // builder model scaffolds the right routes/sections instead of
    // defaulting to a generic landing page.
    if (parsed.template === undefined) {
      parsed.template = pickTemplateForBrief(trimmedBrief);
    }
    direction = parsed;
  } catch (e) {
    console.warn("[design-director] threw:", e);
    return null;
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
