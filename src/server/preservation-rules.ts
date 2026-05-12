/**
 * User-authored preservation rules — "PETAL.md" / ".petalrc".
 *
 * Power-users on Lovable have AGENTS.md, on Cursor .cursorrules. Petal's
 * equivalent is a single markdown file at the project root the user can
 * write to tell Petal:
 *   1. Files / glob patterns to NEVER touch (added to the protected-path
 *      filter alongside the framework-managed paths).
 *   2. Free-text rules, conventions, or preferences to inject into both
 *      the initial-generation and patch system prompts.
 *
 * The file is OPTIONAL. When absent, behaviour is unchanged.
 *
 * Format (lenient — we treat it as markdown the user wrote, not strict JSON):
 *
 *   # PETAL.md
 *
 *   ## Do not modify
 *   - src/lib/payments/**
 *   - src/components/Brand/Logo.tsx
 *
 *   ## Project rules
 *   - Always use TanStack Query, never SWR.
 *   - The brand color is #2D5BFF; do not change it.
 *   - Auth lives in src/lib/auth/* — read it before changing routes.
 *
 * Heading aliases recognised for the no-touch list (case-insensitive):
 *   "do not modify", "do not edit", "preserve", "protected", "no-touch",
 *   "freeze", "locked".
 */

import type { ProjectFile } from "./generate.server";

const PRESERVATION_HEADING_RE =
  /^#{1,6}\s+(?:do[\s-]?not[\s-]?(?:modify|edit|touch|change)|preserve|protected|no[\s-]?touch|freeze|locked)\b/i;
const RULES_HEADING_RE =
  /^#{1,6}\s+(?:project[\s-]?rules?|rules?|conventions?|preferences?|notes?[\s-]?for[\s-]?petal|instructions?)\b/i;
const ANY_HEADING_RE = /^#{1,6}\s+/;

export type PreservationRules = {
  /** Glob patterns the user marked as no-touch. */
  protectedGlobs: string[];
  /** Free-text rules block to inject into the system prompt (already trimmed). */
  rulesText: string;
  /** Source file path — included in the prompt so the model knows where the
   *  user's authoring file lives if it wants to reference it back. */
  sourcePath: string | null;
};

const EMPTY: PreservationRules = { protectedGlobs: [], rulesText: "", sourcePath: null };

/** Locate a user-authored preservation file in the project. */
function findRulesFile(files: ProjectFile[]): ProjectFile | null {
  // Order matters — first hit wins.
  const candidates = ["PETAL.md", "petal.md", ".petalrc", ".petalrc.md", "AGENTS.md"];
  for (const c of candidates) {
    const hit = files.find((f) => f.path === c);
    if (hit) return hit;
  }
  return null;
}

/** Parse a markdown file into a PreservationRules struct. Lenient. */
export function parsePreservationRules(files: ProjectFile[]): PreservationRules {
  const file = findRulesFile(files);
  if (!file || !file.content.trim()) return EMPTY;

  const lines = file.content.split("\n");
  const protectedGlobs: string[] = [];
  const ruleLines: string[] = [];

  type Section = "none" | "preserve" | "rules";
  let section: Section = "none";

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (PRESERVATION_HEADING_RE.test(line)) {
      section = "preserve";
      continue;
    }
    if (RULES_HEADING_RE.test(line)) {
      section = "rules";
      continue;
    }
    if (ANY_HEADING_RE.test(line)) {
      section = "none";
      continue;
    }
    if (section === "preserve") {
      // Accept "- path", "* path", "path" — strip bullet and inline code ticks.
      const stripped = line.replace(/^\s*[-*]\s*/, "").replace(/`/g, "").trim();
      if (stripped && !stripped.startsWith("//") && !stripped.startsWith("#")) {
        protectedGlobs.push(stripped);
      }
    } else if (section === "rules") {
      if (line.trim()) ruleLines.push(line);
    }
  }

  // If the file has no recognised section headings at all, treat the whole
  // body as a free-text rules block. Power-users shouldn't have to follow a
  // strict schema for the simple case of "here's my AGENTS.md".
  if (protectedGlobs.length === 0 && ruleLines.length === 0 && file.content.trim()) {
    return {
      protectedGlobs: [],
      rulesText: file.content.trim(),
      sourcePath: file.path,
    };
  }

  return {
    protectedGlobs,
    rulesText: ruleLines.join("\n").trim(),
    sourcePath: file.path,
  };
}

/** Convert a glob string ('*' / '**' / '?' supported) to a RegExp. */
function globToRegExp(glob: string): RegExp {
  // Escape regex metachars then re-introduce glob semantics.
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("/.+^$()|[]{}\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function makeProtectedGlobMatcher(globs: string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false;
  const compiled = globs.map(globToRegExp);
  return (path: string) => compiled.some((re) => re.test(path));
}

/** Render the preservation block to inject into the system prompt. Empty
 *  string when the user has no rules — keeps token budget clean. */
export function renderPreservationBlock(rules: PreservationRules): string {
  if (!rules.protectedGlobs.length && !rules.rulesText) return "";
  const parts: string[] = [];
  parts.push(
    `\n\nPROJECT RULES (from ${rules.sourcePath ?? "PETAL.md"} — the user authored these; treat them as hard constraints):`,
  );
  if (rules.protectedGlobs.length) {
    parts.push(
      `- DO NOT modify, delete, or rewrite any file matching these patterns: ${rules.protectedGlobs
        .map((g) => `\`${g}\``)
        .join(", ")}. If the user's request requires touching one of these paths, stop and ask the user to update PETAL.md first.`,
    );
  }
  if (rules.rulesText) {
    parts.push(rules.rulesText);
  }
  return parts.join("\n");
}
