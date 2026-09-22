/**
 * Cross-cutting intent detection + file pinning.
 *
 * Broad user requests like "make the site mobile responsive", "improve
 * spacing across all pages", "redesign every form" need the model to see
 * MANY files at once. The default `trimFilesForPrompt` budget drops most
 * of them as "lower-priority", so the model emits `replace` ops whose
 * `search` snippets never match (they were hallucinated against memory,
 * not the actual file bytes). Result: zero ops apply, user gets
 * "I wasn't able to apply that change…".
 *
 * `detectCrossCuttingIntent` returns true when the prompt clearly asks
 * for a site-wide / cross-file change. `pickPinnedPaths` returns the
 * file paths that must be force-included in prompt context for that
 * kind of ask — typically every page and every app-level component.
 */

import type { ProjectFile } from "./generate.server";

const CROSS_CUTTING_REGEXES: RegExp[] = [
  /\b(mobile\s*-?\s*(responsive|friendly|first)|responsive\s+(design|layout|site|app)|make\s+(it|the\s+site|the\s+app|everything)\s+(mobile|responsive))\b/i,
  /\b(across|every|all)\s+(pages?|routes?|screens?|forms?|sections?|components?)\b/i,
  // "the entire website design", "the whole app", "the full landing page" —
  // any broad surface noun, not just the four page synonyms we used to list.
  /\b(entire|whole|full|complete)\s+(website|web\s?site|webpage|web\s?page|site|app|application|ui|design|look|theme|landing\s*page|home\s*page|homepage|front\s*page|main\s*page)\b/i,
  /\b(site\s*-?\s*wide|app\s*-?\s*wide|app-wide|sitewide|whole\s+(site|app))\b/i,
  /\b(redesign|rework|revamp|refresh|redo|remake|rebuild|restyle|re-?theme|overhaul|refactor)\s+(the\s+)?(site|website|app|whole|entire|everything|design|look|theme|style|layout|ui|colou?rs?|landing\s*page|home\s*page|homepage|front\s*page|main\s*page)\b/i,
  // Plain verbs users actually type: "change the design", "update the whole
  // look", "give the site a new style". These are redesigns, not tweaks.
  /\b(change|update|switch|swap|give|make)\s+(the\s+|it\s+|us\s+)?(a\s+|an\s+)?(new\s+|different\s+|fresh\s+|entire\s+|whole\s+)?(website|site|app)?\s*(design|theme|look(\s+and\s+feel)?|style|colou?r\s*(scheme|palette)|palette|branding|vibe|aesthetic)\b/i,
  /\b(every|all)\s+(page|route|screen|form|component)\b/i,
  /\b(global|globally)\s+(change|update|fix|apply|restyle)\b/i,
  /\b(tighten|fix|improve|polish)\s+(the\s+)?(spacing|typography|layout|design)\s+(everywhere|across|on\s+all)\b/i,
];

export function detectCrossCuttingIntent(prompt: string): boolean {
  if (!prompt) return false;
  const text = prompt.slice(0, 4000);
  return CROSS_CUTTING_REGEXES.some((re) => re.test(text));
}


/** Files Kimble may freely edit — excludes scaffold/kit-owned trees. */
function isAppOwned(path: string): boolean {
  if (path.startsWith("src/components/ui/")) return false;
  if (path.startsWith("src/components/blocks/")) return false;
  if (path.startsWith("src/components/examples/")) return false;
  if (path.startsWith("src/components/mobile/")) return false;
  if (path.startsWith("src/integrations/")) return false;
  return true;
}

/**
 * Returns the file paths that should be FORCE-included in prompt context
 * when a cross-cutting intent is detected. The list intentionally covers
 * every page/route file and every app-level component (not the kit).
 */
export function pickPinnedPaths(files: ProjectFile[]): string[] {
  const pinned = new Set<string>();
  for (const f of files) {
    if (!isAppOwned(f.path)) continue;
    if (
      f.path === "src/App.tsx" ||
      f.path === "src/main.tsx" ||
      f.path === "src/styles.css" ||
      f.path === "tailwind.config.ts" ||
      f.path === "tailwind.config.js" ||
      f.path.startsWith("src/pages/") ||
      f.path.startsWith("src/routes/") ||
      (f.path.startsWith("src/components/") && /\.(tsx|jsx)$/.test(f.path))
    ) {
      pinned.add(f.path);
    }
  }
  return Array.from(pinned);
}
