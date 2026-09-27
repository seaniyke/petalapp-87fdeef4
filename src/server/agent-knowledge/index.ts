/**
 * Runtime loader for the canonical agent knowledge (Webby v1.2.30 Markdown).
 *
 * The Markdown files beside this module are the ONE source of generic
 * website-building guidance. They are bundled at build time via Vite `?raw`
 * imports, so they work in the Worker (no filesystem, no absolute paths).
 *
 * The files are never edited. Sections that describe Webby's own tool loop
 * (readFile/template.json/verifyBuild/askUser/site-memory tools, template
 * selection, Supabase wiring, response format) are skipped at load time
 * because Kimble does not have those tools — its runtime rules, output format
 * and verification are supplied by Kimble's own code.
 *
 * platform/ (Shopify/WordPress) is intentionally NOT imported here.
 */
import systemMd from "./system.md?raw";
import compactMd from "./compact.md?raw";
import colorGuideMd from "./color-guide.md?raw";
import copyAndVerifyMd from "./skills/copy-and-verify/SKILL.md?raw";
import motionMd from "./skills/motion/SKILL.md?raw";
import pageCompositionMd from "./skills/page-composition/SKILL.md?raw";
import redesignSafetyMd from "./skills/redesign-safety/SKILL.md?raw";
import sectionArchitecturesMd from "./skills/section-architectures/SKILL.md?raw";

export type KnowledgeSkillId =
  | "copy-and-verify"
  | "motion"
  | "page-composition"
  | "redesign-safety"
  | "section-architectures";

/** Files bundled into normal generation (for audits and tests). */
export const LOADED_KNOWLEDGE_FILES = [
  "system.md",
  "compact.md",
  "color-guide.md",
  "skills/copy-and-verify/SKILL.md",
  "skills/motion/SKILL.md",
  "skills/page-composition/SKILL.md",
  "skills/redesign-safety/SKILL.md",
  "skills/section-architectures/SKILL.md",
] as const;

/**
 * Headings (H2 or H3, matched by prefix after emoji/markers are stripped)
 * whose whole section refers to Webby-only tools, templates or chat voice.
 *
 * Parity note: a filtered heading never means the BEHAVIOUR is dropped. The
 * sections below are filtered because their text names tools Kimble does not
 * have (analyzeProject, verifyBuild, editFile ordering) or describes Webby's
 * scaffold rather than Kimble's — e.g. "critical: never nest browserrouter"
 * tells the model main.tsx already wraps the router, which is FALSE here:
 * Kimble's src/main.tsx mounts <App /> and src/App.tsx owns <BrowserRouter>.
 * Restating that text verbatim would produce routerless apps. The equivalent
 * guarantees (single router, import/export correctness, import path rules,
 * file order, one complete write per file) are stated against Kimble's own
 * tools in CORRECTNESS_RULES in src/server/engine/first-build.ts, and are
 * additionally enforced deterministically by the tool loop's per-write
 * validation.
 */
export const WEBBY_ONLY_HEADINGS: string[] = [
  "your role",
  "how to respond to users",
  "mandatory first steps",
  "template configuration priority",
  "critical: never nest browserrouter",
  "progress updates",
  "planning for tasks",
  "technical details",
  "file organization",
  "mandatory page creation workflow",
  "template context",
  "tools (use in this exact order)",
  "never send multiple parallel editfile",
  "error recovery",
  "when to use analyzeproject",
  "common typescript error patterns",
  "import path rules",
  "token efficiency",
  "first-build optimization",
  "data persistence with supabase",
  "github",
  "design intelligence & site memory",
  "mandatory: stock image library",
  "template selection",
  "layout enforcement",
  "current project files",
  "response format",
  "mandatory checklist",
  "asking the user",
  // compact.md equivalents
  "workflow",
  "supabase tables",
  "stock images",
];

function normHeading(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/[^\p{L}\p{N}\s:&().,'`\-]/gu, "")
    .replace(/`/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Drop Webby-only sections and template placeholders. Pure and deterministic.
 * A dropped H2 removes everything up to the next H2; a dropped H3 removes
 * everything up to the next H2/H3.
 */
export function filterWebbyOnly(md: string): string {
  const out: string[] = [];
  let skipLevel = 0; // 0 = not skipping; else heading level being skipped
  for (const raw of md.split("\n")) {
    const h = /^(#{2,3})\s/.exec(raw);
    if (h) {
      const level = h[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (!skipLevel) {
        const name = normHeading(raw);
        if (WEBBY_ONLY_HEADINGS.some((p) => name.startsWith(p))) {
          skipLevel = level;
          continue;
        }
      }
    }
    if (skipLevel) continue;
    if (/^\s*\{\{[^}]+\}\}\s*$/.test(raw)) continue; // {{INJECT:…}} / {{DYNAMIC:…}}
    out.push(raw);
  }
  return out
    .join("\n")
    .replace(/"\{\{PROJECT_NAME\}\}"/g, "this project")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HEADER = `## Agent knowledge (canonical design & craft manual)
Precedence: Kimble's runtime rules and output format above, then the user's CURRENT request, then this project's real files, design and memory, then this manual. This manual holds defaults for when the user is silent. It was written for a tool-driven agent: where it mentions template.json, routes files, or tools you do not have, apply the intent using the project files and output format you were given.`;

let cache: { full?: string; compact?: string; color?: string } = {};

/** Core manual: full system.md for first builds, compact.md otherwise. */
export function loadCoreKnowledge(mode: "full" | "compact"): { file: "system.md" | "compact.md"; text: string } {
  if (mode === "full") {
    cache.full ??= `${HEADER}\n\n${filterWebbyOnly(systemMd)}`;
    return { file: "system.md", text: cache.full };
  }
  cache.compact ??= `${HEADER}\n\n${filterWebbyOnly(compactMd)}`;
  return { file: "compact.md", text: cache.compact };
}

export function loadColorGuide(): string {
  cache.color ??= `## Colour guide\n${filterWebbyOnly(colorGuideMd)}`;
  return cache.color;
}

const SKILL_SOURCE: Record<KnowledgeSkillId, string> = {
  "copy-and-verify": copyAndVerifyMd,
  motion: motionMd,
  "page-composition": pageCompositionMd,
  "redesign-safety": redesignSafetyMd,
  "section-architectures": sectionArchitecturesMd,
};

/** A skill's Markdown body with YAML front matter removed. */
export function loadSkillKnowledge(id: KnowledgeSkillId): string {
  return filterWebbyOnly(SKILL_SOURCE[id].replace(/^---\n[\s\S]*?\n---\n?/, ""));
}

/** Test hook. */
export function __resetKnowledgeCache() {
  cache = {};
}
