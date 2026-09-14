/**
 * Phase 4 — "what you're looking at".
 *
 * The builder reports which route of the generated app is open in the preview
 * (and, when the user picked one, the element they clicked). Edit turns carry
 * that along so a request like "make this page's header smaller" or "this
 * button should be white" resolves to the page actually on screen instead of
 * the model guessing from prose.
 *
 * Pure string work: no I/O, no model call, never throws.
 */

export type ViewElement = {
  tag?: string;
  text?: string;
  id?: string | null;
  classes?: string | null;
  sourceFile?: string | null;
  sourceLine?: string | null;
};

export type ViewContext = {
  path?: string;
  title?: string;
  heading?: string | null;
  element?: ViewElement | null;
};

/** Route path -> slug tokens ("/products/new" -> ["products", "new"]). */
function routeTokens(path: string): string[] {
  return path
    .split("#")[0]
    .split("?")[0]
    .split("/")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 1 && !/^[0-9a-f-]{8,}$/.test(part));
}

/**
 * Best-effort: which project files most likely render the open route.
 * Matches page/route files by slug; "/" maps to the home/index page.
 */
export function routeCandidatePaths(
  view: ViewContext | null | undefined,
  allPaths: string[],
  limit = 4,
): string[] {
  const path = view?.path?.trim();
  if (!path) return [];
  const tokens = routeTokens(path);
  const wanted = tokens.length > 0 ? tokens : ["home", "index", "landing"];
  const scored: Array<{ p: string; score: number }> = [];
  for (const p of allPaths) {
    if (!/^src\//.test(p)) continue;
    if (!/\.(tsx|jsx)$/.test(p)) continue;
    const lower = p.toLowerCase();
    const isPageish = /\/(pages|routes|screens|views|app)\//.test(lower);
    let score = 0;
    for (const token of wanted) {
      if (lower.includes(`/${token}.`) || lower.includes(`/${token}/`)) score += 3;
      else if (lower.includes(token)) score += 1;
    }
    if (score === 0) continue;
    if (isPageish) score += 2;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  return scored.slice(0, limit).map((s) => s.p);
}

/** Prompt block describing the screen the user is looking at. */
export function renderViewContext(
  view: ViewContext | null | undefined,
  candidatePaths: string[] = [],
): string {
  if (!view) return "";
  const path = view.path?.trim();
  const el = view.element;
  if (!path && !el) return "";

  const lines: string[] = ["", "WHAT THE USER IS LOOKING AT RIGHT NOW:"];
  if (path) {
    lines.push(`- Open page in the preview: ${path}`);
    if (view.title) lines.push(`- Page title: ${view.title}`);
    if (view.heading) lines.push(`- Main heading on screen: "${view.heading}"`);
    if (candidatePaths.length > 0) {
      lines.push(`- Files most likely rendering this page: ${candidatePaths.join(", ")}`);
    }
  }
  if (el) {
    const bits: string[] = [];
    if (el.tag) bits.push(`<${el.tag}>`);
    if (el.text) bits.push(`text "${el.text.slice(0, 120)}"`);
    if (el.id) bits.push(`id #${el.id}`);
    if (el.classes) bits.push(`class "${el.classes.slice(0, 160)}"`);
    if (el.sourceFile) {
      bits.push(`source ${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ""}`);
    }
    if (bits.length > 0) lines.push(`- Element the user selected: ${bits.join(" · ")}`);
  }
  lines.push(
    "Unqualified references such as \"this page\", \"here\", \"this section\" or \"this button\" mean the screen above. Do not edit a different page unless the user named one.",
  );
  return `\n${lines.join("\n")}\n`;
}
