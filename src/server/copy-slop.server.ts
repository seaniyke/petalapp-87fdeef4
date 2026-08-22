/**
 * Copy slop scanner.
 *
 * Palettes and fonts are only half of "AI slop" — the other half is the
 * writing. Generated landing pages default to a small, instantly recognisable
 * vocabulary ("Unleash the power of", "Elevate your workflow", "seamlessly
 * integrate", "revolutionary AI-powered platform") plus placeholder debris
 * ("Feature One", "Your Company", "hello@example.com", "Lorem ipsum").
 *
 * This module finds that text in JSX/TS string literals and reports it as
 * `LocalIssue` notes, so the existing generation-quality-gate and the
 * post-stream autofix can act on it. It never blocks a build.
 *
 * It is deliberately deterministic (no model call): the phrase list is the
 * contract, so the same input always produces the same findings, and the same
 * list can be enforced against Petal's own marketing copy in tests.
 */

import type { ProjectFile } from "@/server/generate.server";
import type { LocalIssue } from "@/server/local-verifier";

export type SlopHit = {
  /** The offending phrase, as matched. */
  phrase: string;
  /** Why it is banned / what to write instead. */
  guidance: string;
};

type SlopRule = { rx: RegExp; guidance: string };

/**
 * Marketing filler. Each of these is a phrase that carries no information —
 * it could appear on any product's page without changing meaning.
 */
const FILLER_RULES: SlopRule[] = [
  { rx: /\bunleash (?:the )?(?:power|potential)\b/gi, guidance: "say what the product does instead" },
  { rx: /\belevate your\b/gi, guidance: "name the concrete outcome" },
  { rx: /\btake your \w+ to the next level\b/gi, guidance: "state the actual improvement" },
  { rx: /\bseamlessly? integrat(?:e|es|ed|ion)\b/gi, guidance: "name what it connects to" },
  { rx: /\bcutting[- ]edge\b/gi, guidance: "drop the adjective, state the capability" },
  { rx: /\bstate[- ]of[- ]the[- ]art\b/gi, guidance: "drop the adjective, state the capability" },
  { rx: /\bgame[- ]chang(?:er|ing)\b/gi, guidance: "describe the change" },
  { rx: /\brevolutionar(?:y|ise|ize)\b/gi, guidance: "describe the change" },
  { rx: /\bempower(?:ing|s)? (?:your|you|teams?|businesses|users)\b/gi, guidance: "say what they can now do" },
  { rx: /\bsupercharge\b/gi, guidance: "say what gets faster and by how much" },
  { rx: /\bunlock (?:the )?(?:power|potential|possibilities)\b/gi, guidance: "state the feature" },
  { rx: /\bone[- ]stop[- ]shop\b/gi, guidance: "list what it actually covers" },
  { rx: /\bworld[- ]class\b/gi, guidance: "unverifiable claim — cut it" },
  { rx: /\bbest[- ]in[- ]class\b/gi, guidance: "unverifiable claim — cut it" },
  { rx: /\bindustry[- ]leading\b/gi, guidance: "unverifiable claim — cut it" },
  { rx: /\btrusted by (?:thousands|millions|industry leaders)\b/gi, guidance: "invented social proof — cut or use real numbers" },
  { rx: /\bjoin (?:thousands|millions) of\b/gi, guidance: "invented social proof — cut or use real numbers" },
  { rx: /\bin (?:just )?(?:a few|three|3) simple steps\b/gi, guidance: "describe the steps themselves" },
  { rx: /\bthe future of \w+ is here\b/gi, guidance: "cut — says nothing" },
  { rx: /\bwhere \w+ meets \w+\b/gi, guidance: "cut — tagline mad-lib" },
  { rx: /\bdesigned to help you\b/gi, guidance: "say what it does, not what it was designed to do" },
  { rx: /\bwhether you'?re an? [\w\s]{3,30} or an? [\w\s]{3,30},/gi, guidance: "cut the whether/or preamble" },
  { rx: /\blorem ipsum\b/gi, guidance: "placeholder text left in shipped copy" },
];

/**
 * Placeholder debris — content that proves nobody filled the template in.
 */
const PLACEHOLDER_RULES: SlopRule[] = [
  { rx: /\bFeature (?:One|Two|Three|1|2|3)\b/g, guidance: "unnamed feature placeholder" },
  { rx: /\bYour (?:Company|Brand|Product|Logo)\b/g, guidance: "brand placeholder — use the real product name" },
  { rx: /\b(?:Acme|Company Name|Brand Name)\b/g, guidance: "brand placeholder — use the real product name" },
  { rx: /\b(?:hello|info|contact|support)@(?:example|yourcompany|company|domain)\.com\b/gi, guidance: "placeholder email address" },
  { rx: /\bJohn Doe\b|\bJane Doe\b/g, guidance: "placeholder person name" },
  { rx: /\bhttps?:\/\/(?:example|yoursite|yourdomain)\.com/gi, guidance: "placeholder URL" },
  { rx: /\bComing soon\b/gi, guidance: "unfinished section — build it or remove it" },
  { rx: /\bTODO\b|\bTBD\b/g, guidance: "unfinished marker in shipped copy" },
];

const ALL_RULES: SlopRule[] = [...FILLER_RULES, ...PLACEHOLDER_RULES];

/**
 * Reduce a source file to just the human-visible text: JSX text nodes and
 * string literals. Scanning raw source produces false positives on identifiers
 * and imports (a component genuinely named `FeatureOne`, a `todo` variable).
 */
export function extractVisibleText(source: string): string {
  const out: string[] = [];

  // JSX text between tags — the bulk of landing copy.
  for (const m of source.matchAll(/>([^<>{}]{3,400})</g)) {
    out.push(m[1]);
  }
  // String and template literals (titles, alt text, meta descriptions, arrays
  // of feature objects).
  for (const m of source.matchAll(/"([^"\\\n]{3,400})"|'([^'\\\n]{3,400})'|`([^`\\$]{3,400})`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }

  return out.join("\n");
}

/** Strip line comments so a note about slop is not itself flagged as slop. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Find every banned phrase in one file's visible copy. */
export function findCopySlop(source: string): SlopHit[] {
  const text = extractVisibleText(stripComments(source));
  const hits: SlopHit[] = [];
  const seen = new Set<string>();

  for (const { rx, guidance } of ALL_RULES) {
    for (const m of text.matchAll(rx)) {
      const phrase = m[0].trim();
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ phrase, guidance });
    }
  }
  return hits;
}

/** Files whose copy is user-visible and therefore worth scanning. */
function isCopyBearing(path: string): boolean {
  if (!/\.(tsx|jsx|html)$/.test(path)) return false;
  if (/\/(?:__tests__|tests?)\//.test(path)) return false;
  return true;
}

/**
 * Scan a generated project and report copy slop as quality-gate issues.
 * Informational only — never blocks a build.
 */
export function findCopySlopIssues(files: ProjectFile[]): LocalIssue[] {
  const issues: LocalIssue[] = [];

  for (const file of files) {
    if (!isCopyBearing(file.path)) continue;
    const hits = findCopySlop(file.content);
    if (hits.length === 0) continue;

    const preview = hits
      .slice(0, 5)
      .map((h) => `"${h.phrase}" (${h.guidance})`)
      .join("; ");

    issues.push({
      path: file.path,
      kind: "render-risk",
      detail:
        `copy-slop: ${hits.length} generic AI phrase(s) in visible copy — ${preview}. ` +
        `Rewrite with specifics about THIS product: what it does, for whom, and the concrete outcome. ` +
        `No unverifiable superlatives, no invented social proof, no placeholder names or emails.`,
    });
  }

  return issues;
}

/**
 * The rule, in prose, for injection into the generation prompt so the model
 * avoids the phrases in the first place instead of being corrected afterwards.
 */
export const COPY_CONTRACT_BLOCK = `## Copy contract (no AI filler)
Every line of visible copy must be specific to THIS product. Banned outright:
- Hype with no content: "unleash the power of", "elevate your", "take X to the next level", "cutting-edge", "state-of-the-art", "game-changing", "revolutionary", "supercharge", "seamlessly integrate", "world-class", "best-in-class", "industry-leading".
- Invented proof: "trusted by thousands", "join millions of users", fabricated testimonials, made-up logos, star ratings nobody gave, statistics with no source. If there is no real number, write a fact instead ("built on X", "exports to Y").
- Placeholders: "Feature One", "Your Company", "Acme", "Lorem ipsum", "John Doe", hello@example.com, example.com links, "Coming soon", "TODO".
- Mad-lib taglines: "Where X meets Y", "The future of X is here", "Whether you're a A or a B, ...".
Write instead: concrete nouns and verbs, the actual capability, who it is for, and what changes after using it. Headlines are short and declarative. A testimonial only ships if the user supplied it.`;
