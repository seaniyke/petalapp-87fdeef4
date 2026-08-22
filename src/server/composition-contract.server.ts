/**
 * Composition contract.
 *
 * `copy-slop.server.ts` polices the writing and `anti-sameness.server.ts`
 * polices palette/typography tokens. Neither catches the most common
 * remaining failure: a page that is technically "styled" but structurally
 * a placeholder — a stack of bare paragraphs and unstyled lists with no
 * card surfaces, no grid, no type-scale jump, and no emphasis.
 *
 * This module is the structural half of the design contract:
 *   - a prompt block the model reads BEFORE writing any screen, and
 *   - a deterministic scanner that reports flat screens afterwards.
 *
 * Pure string/regex work. Informational only — never blocks a build.
 */

import type { ProjectFile } from "@/server/generate.server";
import type { LocalIssue } from "@/server/local-verifier";

/* ------------------------------------------------------------------ *
 * Structural signals
 * ------------------------------------------------------------------ */

/** Card / panel surfaces: an elevated or bounded container. */
const SURFACE_RE =
  /\b(?:rounded-(?:md|lg|xl|2xl|3xl|full)|shadow-(?:sm|md|lg|xl|2xl)|border(?:-[trbl])?\b[^"']*\bp[xy]?-\d|bg-(?:card|surface|muted|secondary|popover|accent))\b|<Card\b|CardContent|CardHeader|Panel\b/;

/** Multi-column composition: a grid or a responsive flex row. */
const GRID_RE =
  /\bgrid-cols-\d|\bmd:grid-cols-\d|\bsm:grid-cols-\d|\blg:grid-cols-\d|\bcolumns-\d|\bflex-row\b[^"']*\bgap-\d/;

/** A real display-scale heading, not body-sized text pretending to be one. */
const TYPE_SCALE_RE = /\btext-(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/;

/** Emphasis styling: weight, tracking, accent chips, gradients on type. */
const EMPHASIS_RE =
  /\bfont-(?:semibold|bold|extrabold|black)\b|\btracking-(?:tight|tighter|wide|widest)\b|<Badge\b|\brounded-full\b[^"']*\b(?:px|py)-\d|\btext-primary\b|\bbg-primary\b|\bbg-gradient-to-/;

/** Spacing rhythm: sections that breathe. */
const RHYTHM_RE = /\bp[yt]-(?:1[0-9]|2[0-9]|3[0-2])\b|\bspace-y-(?:6|8|10|12|16)\b|\bgap-(?:6|8|10|12)\b/;

export type CompositionSignal =
  | "surface"
  | "grid"
  | "type-scale"
  | "emphasis"
  | "rhythm";

const SIGNAL_FIXES: Record<CompositionSignal, string> = {
  surface:
    "no card/panel surfaces — wrap grouped content in elevated cards (rounded-2xl, border, bg-card, padding)",
  grid: "no multi-column composition — lay peers out on a responsive grid instead of one long stack",
  "type-scale":
    "no display-scale heading — the page title must jump to text-3xl+ (hero text-5xl+) with tight tracking",
  emphasis:
    "no emphasis styling — add weight contrast, an accent chip/badge, or an accented primary action",
  rhythm: "no vertical rhythm — sections need generous padding (py-16 md:py-24) and consistent gaps",
};

/** Files that render a screen the user actually looks at. */
function isScreenFile(path: string): boolean {
  if (!/\.(tsx|jsx)$/.test(path)) return false;
  if (/\/(?:__tests__|tests?)\//.test(path)) return false;
  if (/\.(test|spec)\.[jt]sx?$/.test(path)) return false;
  return (
    /^src\/(?:pages|routes|screens)\//.test(path) ||
    /^src\/components\/sections\//.test(path) ||
    path === "src/App.tsx"
  );
}

/** JSX-bearing and long enough to be a real screen, not a re-export. */
function isSubstantial(content: string): boolean {
  return content.includes("<") && content.split("\n").length >= 25;
}

/** Which composition signals are missing from one screen. */
export function findMissingComposition(content: string): CompositionSignal[] {
  const missing: CompositionSignal[] = [];
  if (!SURFACE_RE.test(content)) missing.push("surface");
  if (!GRID_RE.test(content)) missing.push("grid");
  if (!TYPE_SCALE_RE.test(content)) missing.push("type-scale");
  if (!EMPHASIS_RE.test(content)) missing.push("emphasis");
  if (!RHYTHM_RE.test(content)) missing.push("rhythm");
  return missing;
}

/**
 * Report screens that render as flat placeholders.
 *
 * A screen trips only when it misses THREE or more signals — a deliberately
 * minimal page that still uses cards and a type jump is fine.
 */
export function findCompositionIssues(files: ProjectFile[]): LocalIssue[] {
  const issues: LocalIssue[] = [];

  for (const file of files) {
    if (!isScreenFile(file.path)) continue;
    if (!isSubstantial(file.content)) continue;

    const missing = findMissingComposition(file.content);
    if (missing.length < 3) continue;

    issues.push({
      path: file.path,
      kind: "render-risk",
      detail:
        `composition-contract: ${file.path} renders as a flat placeholder — ` +
        missing.map((m) => SIGNAL_FIXES[m]).join("; ") +
        `. Recompose it with the project's design system: page header with display heading, ` +
        `content grouped into elevated cards on a responsive grid, one emphasised primary action.`,
    });
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * Prompt block
 * ------------------------------------------------------------------ */

export const COMPOSITION_CONTRACT_BLOCK = `## Composition contract (structure, not just colour)
Every screen you write — landing AND interior app pages — must be COMPOSED, never a bare stack of text and unstyled lists. Each screen must satisfy all five:

1. Surfaces. Group related content into real card/panel surfaces: rounded-2xl, hairline border, bg-card, generous internal padding, and a soft shadow on the elevated ones. Tables, forms, metrics, lists and empty states all live on a surface — never floating on the page background.
2. Grid. Peers are laid out on a responsive grid (grid gap-6 sm:grid-cols-2 lg:grid-cols-3, or an intentional asymmetric span), not a single long vertical stack. Break symmetric triplets: give one item a wider span or a different treatment.
3. Type scale. There is a real jump: page/hero heading at text-4xl→text-7xl (responsive, tracking-tight), section headings text-2xl→text-3xl, body text-base, metadata text-sm muted. Never a page where the heading is the same size as the body.
4. Emphasis. Every screen has exactly one visually dominant element (hero headline, primary metric, primary CTA) plus supporting emphasis: weight contrast, an accent chip/badge for status or category, and one filled primary button with real button chrome. Secondary actions are outlined or ghost — never bare underlined text.
5. Rhythm and states. Sections use py-16 md:py-24 (hero py-20 md:py-28) and consistent gaps. Every data surface ships loading skeletons, an empty state with one explanatory sentence and the primary action, and an error state with retry.

Landing pages additionally require: distinctive hero (headline + subhead + primary CTA + a real visual — product mock, photo, or composed illustration, never a lone icon), a feature grid with mixed emphasis, pricing and/or testimonials, and a strong final call to action band before the footer.

If a draft screen would render as headings-plus-paragraphs with no card, no grid and no scale jump, REWRITE it before emitting. A placeholder-looking screen is a defect, not a style.`;
