/**
 * Junk-page pruner.
 *
 * Observed failure (salon booking build): alongside the real screens the
 * model emitted `src/pages/Hooks.tsx`, `src/pages/Main.tsx` and
 * `src/pages/UseAxe.tsx` — pages named after code concepts whose body is a
 * one-line "placeholder". Orphan-page wiring then dutifully routed them, so
 * the shipped app had /hooks and /use-axe in its navigation.
 *
 * Prompt rules alone can't guarantee this never happens, so this pass deletes
 * them deterministically BEFORE routing runs. Two conditions must both hold —
 * a code-concept name AND placeholder-looking content — so a genuine screen
 * called "Main" with real markup is never removed.
 *
 * Pure: ProjectFile[] -> ProjectFile[].
 */

import type { ProjectFile } from "./generate.server";

const PAGE_PATH = /^src\/(pages|screens)\/([A-Za-z0-9_-]+)\.(tsx|jsx)$/;

/** Names that describe code, not a screen a user could navigate to. */
const CODE_CONCEPT = new RegExp(
  [
    "^(?:",
    "use-?[a-z0-9-]*",
    "|hooks?|utils?|helpers?|types?|constants?|configs?|main|entry|index",
    "|stores?|contexts?|providers?|libs?|apis?|services?",
    "|schemas?|routes?|router|styles?|assets?|tests?|mocks?|data",
    "|components?|pages?|screens?|placeholder|examples?|untitled|new-page",
    ")$",
  ].join(""),
  "i",
);

/** Text that means "nothing was really built here". */
const PLACEHOLDER_TEXT = /\b(placeholder|coming soon|todo|lorem ipsum|under construction|tbd)\b/i;

function normalizedName(raw: string): string {
  return raw.replace(/[_\s]+/g, "-").toLowerCase();
}

/** Rough "is there a real screen in here?" measure. */
function looksEmpty(src: string): boolean {
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const jsxTags = (body.match(/<[A-Za-z][^>]*>/g) ?? []).length;
  const visibleText = body
    .match(/>([^<>{}]{3,})</g)
    ?.map((s) => s.slice(1, -1).trim())
    .filter(Boolean) ?? [];
  if (PLACEHOLDER_TEXT.test(visibleText.join(" "))) return true;
  // Tiny file with almost no markup and no data/handlers: not a real screen.
  const hasBehavior = /\b(useState|useEffect|useQuery|supabase|onSubmit|onClick|fetch\()/.test(body);
  return body.trim().length < 700 && jsxTags <= 6 && !hasBehavior;
}

export interface JunkPagePruneResult {
  files: ProjectFile[];
  notes: string[];
  removed: string[];
}

export function pruneJunkPages(files: ProjectFile[]): JunkPagePruneResult {
  const doomed = new Set<string>();

  for (const f of files) {
    const m = PAGE_PATH.exec(f.path);
    if (!m) continue;
    const name = normalizedName(m[2]);
    if (!CODE_CONCEPT.test(name)) continue;
    // `index`/`main` are legitimate entry pages when they hold a real screen.
    if (!looksEmpty(f.content)) continue;
    doomed.add(f.path);
  }

  if (doomed.size === 0) return { files, notes: [], removed: [] };

  // Never delete something another file imports — that would trade a junk page
  // for a broken build. Routing happens after this pass, so an unreferenced
  // page is genuinely unreachable.
  const kept = new Set<string>();
  for (const f of files) {
    if (doomed.has(f.path)) continue;
    for (const p of doomed) {
      const bare = p.replace(/^src\//, "").replace(/\.(tsx|jsx)$/, "");
      const leaf = bare.split("/").pop()!;
      if (
        f.content.includes(`@/${bare}`) ||
        new RegExp(`["']\\.{1,2}/(?:[^"']*/)?${leaf}["']`).test(f.content)
      ) {
        kept.add(p);
      }
    }
  }

  const removed = [...doomed].filter((p) => !kept.has(p));
  if (removed.length === 0) return { files, notes: [], removed: [] };

  return {
    files: files.filter((f) => !removed.includes(f.path)),
    notes: [
      `junk-pages: removed ${removed.length} placeholder page(s) named after code concepts (${removed
        .map((p) => p.split("/").pop())
        .join(", ")})`,
    ],
    removed,
  };
}
