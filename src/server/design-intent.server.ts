/**
 * Design intent + category composition.
 *
 * Two small, deterministic additions to the design context that already
 * reaches the code-writing model. No AI call, no second pass, no agent.
 *
 *  1. What the person actually asked for wins. "Make it brutalist" must not
 *     be quietly replaced by a generic premium-SaaS direction.
 *  2. Different kinds of site get different section composition. The
 *     industry catalogue already describes this; it simply was never
 *     reaching a build.
 *
 * Pure except for one lazy import of the catalogue. Never throws.
 */

import type { DesignDirection, MotionIntensity } from "./design-director.server";

/** Style words a person can state outright, mapped to the vibe they mean. */
const STATED_VIBES: Array<{ re: RegExp; vibe: string }> = [
  { re: /\bbrutalis(t|m)\b/i, vibe: "brutalist" },
  { re: /\bneo-?brutalis(t|m)\b/i, vibe: "neo-brutalist" },
  { re: /\bminimal(ist|ism)?\b/i, vibe: "minimal" },
  { re: /\bluxur(y|ious)|premium|high-?end\b/i, vibe: "luxury" },
  { re: /\bretro|vintage|nostalgic\b/i, vibe: "retro" },
  { re: /\bediting|editorial|magazine\b/i, vibe: "editorial" },
  { re: /\bswiss|international style|grid-?based\b/i, vibe: "swiss" },
  { re: /\bplayful|fun|quirky|bubbly\b/i, vibe: "playful" },
  { re: /\bneon|cyberpunk|synthwave\b/i, vibe: "neon cyberpunk" },
  { re: /\bglass(morphism)?|frosted\b/i, vibe: "glassmorphic" },
  { re: /\bbold|loud|maximalis(t|m)\b/i, vibe: "bold maximalist" },
  { re: /\bcorporate|professional|serious\b/i, vibe: "corporate" },
  { re: /\bhand-?drawn|sketch|organic\b/i, vibe: "hand-drawn" },
  { re: /\bmonochrome|black and white|greyscale|grayscale\b/i, vibe: "monochrome" },
];

export interface StatedDesignIntent {
  vibe?: string;
  paletteMood?: string;
  motion?: MotionIntensity;
  /** The exact phrases used, so they can be quoted back into the prompt. */
  phrases: string[];
}

/** Read the design the person stated in their own words. */
export function readStatedDesignIntent(brief: string): StatedDesignIntent | null {
  const text = String(brief ?? "");
  if (!text.trim()) return null;
  const phrases: string[] = [];
  let vibe: string | undefined;

  for (const entry of STATED_VIBES) {
    const m = text.match(entry.re);
    if (m) {
      vibe ??= entry.vibe;
      phrases.push(m[0].toLowerCase());
    }
  }

  let paletteMood: string | undefined;
  const dark = /\bdark (mode|theme|ui|site|design)\b/i.test(text);
  const light = /\blight (mode|theme|ui|site|design)\b/i.test(text);
  if (dark) {
    paletteMood = "dark";
    phrases.push("dark");
  } else if (light) {
    paletteMood = "light";
    phrases.push("light");
  }
  const colorWord = text.match(
    /\b(black|white|red|orange|amber|yellow|green|emerald|teal|blue|navy|indigo|violet|purple|pink|beige|cream|earthy|pastel|neon)\b/i,
  );
  if (colorWord) {
    paletteMood = paletteMood ? `${paletteMood}, ${colorWord[1].toLowerCase()}` : colorWord[1].toLowerCase();
    phrases.push(colorWord[1].toLowerCase());
  }

  let motion: MotionIntensity | undefined;
  if (/\bno (animation|animations|motion)|static|don'?t animate\b/i.test(text)) {
    motion = "still";
    phrases.push("no animation");
  } else if (/\bcinematic|award-?winning|3d scroll\b/i.test(text)) {
    motion = "cinematic";
    phrases.push("cinematic");
  } else if (/\banimated|lively|motion-?rich\b/i.test(text)) {
    motion = "expressive";
    phrases.push("animated");
  }

  if (!vibe && !paletteMood && !motion) return null;
  return { vibe, paletteMood, motion, phrases: Array.from(new Set(phrases)) };
}

/**
 * The person's own words beat the auto-picked direction.
 * Returns the same object when nothing was stated.
 */
export function applyStatedIntent(
  direction: DesignDirection | null,
  intent: StatedDesignIntent | null,
): DesignDirection | null {
  if (!direction || !intent) return direction;
  const next: DesignDirection = { ...direction };
  if (intent.vibe) next.vibe = intent.vibe;
  if (intent.paletteMood) next.palette_mood = intent.paletteMood;
  if (intent.motion) next.motion = intent.motion;
  return next;
}

/** A short, non-negotiable restatement of what the person asked for. */
export function renderStatedIntentBlock(intent: StatedDesignIntent | null): string {
  if (!intent) return "";
  const lines: string[] = [];
  if (intent.vibe) lines.push(`- vibe: ${intent.vibe} — this is the person's own word. Do not soften it into a generic clean-SaaS look.`);
  if (intent.paletteMood) lines.push(`- palette: ${intent.paletteMood}, as asked for.`);
  if (intent.motion) lines.push(`- motion: ${intent.motion}, as asked for.`);
  return (
    `\n\n### Stated by the person (highest priority — overrides every default below)\n` +
    lines.join("\n") +
    `\n`
  );
}

/**
 * Section composition for the kind of site being built.
 *
 * Reuses the existing industry catalogue rather than inventing a second one.
 * Returns "" when nothing matches, so nothing generic is ever forced on.
 */
export async function renderCategoryCompositionBlock(brief: string): Promise<string> {
  const text = String(brief ?? "").toLowerCase();
  if (text.trim().length < 4) return "";
  try {
    const { INDUSTRY_PACKS } = await import("@/lib/industry-packs");
    let best: (typeof INDUSTRY_PACKS)[number] | null = null;
    let bestScore = 0;
    for (const pack of INDUSTRY_PACKS) {
      const words = new Set(
        `${pack.slug} ${pack.name} ${pack.tagline}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .split(" ")
          .filter((w) => w.length > 3),
      );
      let score = 0;
      for (const w of words) if (text.includes(w)) score += 1;
      // The category's own name counts double — it is the strongest signal.
      if (text.includes(pack.slug.replace(/-/g, " ")) || text.includes(pack.name.toLowerCase())) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = pack;
      }
    }
    if (!best || bestScore < 3) return "";
    const sections = best.pages.map((p) => `  - ${p.path} — ${p.purpose}`).join("\n");
    return (
      `\n\n### Composition for this kind of site (${best.name})\n` +
      `Different kinds of site need different composition. Use this shape unless the person asked for something else; build only the pages they actually asked for.\n` +
      `${sections}\n`
    );
  } catch {
    // A missing catalogue means no extra guidance, never a failed build.
    return "";
  }
}
