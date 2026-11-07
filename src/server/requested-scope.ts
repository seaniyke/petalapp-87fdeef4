/**
 * Requested scope — the user's words are authoritative.
 *
 * Deterministic (no AI) extraction of the pages a user explicitly named, and
 * the rule that narrows any template/archetype route list to that scope.
 * Templates may shape style and layout; they may never add pages.
 */

const STOP = new Set([
  "a", "an", "the", "with", "and", "or", "of", "for", "my", "our", "your",
  "separate", "multiple", "several", "different", "these", "following", "all",
  "new", "own", "its", "their", "few", "some", "other", "more", "main", "web",
  "landing", "only", "just", "etc", "page", "pages", "single", "one", "two", "three", "four", "five", "six", "seven",
]);

const HOME = /^(home|homepage|landing|index|front)$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanName(raw: string): string | null {
  const words = raw
    .toLowerCase()
    .replace(/[“”"'`()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  if (words.length === 0 || words.length > 3) return null;
  const n = words.join(" ");
  if (!/^[a-z][a-z0-9 &-]*$/.test(n)) return null;
  return n;
}

/**
 * Page names the user explicitly listed. Recognises:
 *   "Home, Menu, About, Contact pages"
 *   "pages: Home, Menu and Contact" / "pages (Home, Menu)"
 *   "a menu page", "an about page"
 * Returns [] when no explicit page list is present.
 */
export function extractRequestedPages(prompt: string): string[] {
  const raw = prompt.replace(/\s+/g, " ");
  const found: string[] = [];
  const push = (raw: string) => {
    for (const part of raw.split(/,|\/|\band\b|\+|;/i)) {
      // Layout words describe the site's shape, not a page ("a one-page
      // landing page" names no page called /one-page).
      const stripped = part.replace(/\b(one|single)[- ]?page(r)?\b|\b(landing|simple|small|web|website|single|one)\b/gi, " ").trim();
      if (!stripped) continue;
      const n = cleanName(stripped);
      if (n && !found.includes(n)) found.push(n);
    }
  };

  // "pages (A, B)" — here the parentheses ARE the page list.
  for (const m of raw.matchAll(/\bpages?\s*\(([^)]{2,160})\)/gi)) {
    push(m[1]);
  }
  // Everywhere else a parenthetical describes what goes ON a page
  // ("Home (hero, testimonials, call to action)"): sections, never pages.
  const text = raw.replace(/\bpages?\s*\([^)]*\)/gi, " ").replace(/\([^()]*\)/g, " ");
  // "pages: A, B and C" / "pages — A, B"
  for (const m of text.matchAll(/\bpages?\s*(?::|—|-|including|include)\s*([^.!?\n)]{2,160})/gi)) {
    push(m[1]);
  }
  // "A, B, C and D pages" — also the Oxford comma "A, B, and C pages"
  // (", and" is ONE separator; missing it dropped every page but Home).
  for (const m of text.matchAll(/((?:[A-Za-z][\w&-]*\s*(?:,\s*(?:and\b|&)?|\band\b|&|\/|\+)\s*){1,9}[A-Za-z][\w&-]*)\s+pages\b/gi)) {
    push(m[1]);
  }
  // single "X page" mentions ("a menu page", "the contact page")
  for (const m of text.matchAll(/\b(?:a|an|the|with|plus|and)\s+([A-Za-z][\w&-]*(?:\s+[A-Za-z][\w&-]*)?)\s+page\b/gi)) {
    push(m[1]);
  }
  return found;
}

/** Page name → route path. "home" → "/". */
export function pageNameToRoute(name: string): string {
  return HOME.test(name.replace(/\s+/g, "")) ? "/" : `/${slugify(name)}`;
}

/** True when the prompt describes only a single page ("a bakery homepage"). */
export function isSinglePageRequest(prompt: string): boolean {
  return (
    /\b(home ?page|landing page|one[- ]pager|single[- ]page|one page)\b/i.test(prompt) &&
    !/\bpages\b/i.test(prompt.replace(/\b(single|one)[- ]page\b/gi, ""))
  );
}

/**
 * Narrow a template's route list to what the user asked for.
 * - Explicit page list → exactly those pages (+ "/").
 * - Single-page request → "/" only.
 * - Marketing site without a list → "/" only (templates never add pages).
 * - App without a list → template routes kept as the app's core screens.
 */
export function narrowRoutesToRequest(
  prompt: string,
  templateRoutes: string[],
  opts?: { marketing?: boolean },
): string[] {
  const named = extractRequestedPages(prompt);
  if (named.length > 0) {
    const out = ["/"];
    for (const n of named) {
      const r = pageNameToRoute(n);
      // Prefer the template's spelling when it matches by last segment.
      const tpl = templateRoutes.find((t) => t.split("/").pop() === r.slice(1));
      const route = tpl ?? r;
      if (!out.includes(route)) out.push(route);
    }
    return out;
  }
  if (isSinglePageRequest(prompt) || opts?.marketing) return ["/"];
  return templateRoutes;
}

/**
 * Output-size model for first builds (completion tokens).
 *
 * Calibrated against real runs: the Rise & Crumb four-page café emitted
 * >18,000 tokens in one pass (shell + four rich pages ≈ 4.5K/page), which is
 * the failure this split exists to prevent. Figures are deliberately a little
 * pessimistic — an over-split costs one extra call, an under-split costs a
 * truncated build.
 */
export const OUTPUT_CEILING = 18_000;
/** A unit is planned to use at most this much, leaving ~40% headroom. */
export const SAFE_UNIT_BUDGET = 11_000;
/** Fraction of the real output ceiling a planned unit may use (estimation error headroom). */
export const UNIT_BUDGET_FRACTION = 0.8;

/**
 * INVARIANT: a planned unit must fit inside the actual generation budget.
 * The safe budget is derived from the real max_tokens the call will send.
 */
export function safeUnitBudget(maxOutputTokens?: number | null): number {
  if (!maxOutputTokens || maxOutputTokens <= 0) return SAFE_UNIT_BUDGET;
  return Math.min(SAFE_UNIT_BUDGET, Math.floor(maxOutputTokens * UNIT_BUDGET_FRACTION));
}

const SHELL_TOKENS = 4_500; // router, nav, footer, styles, shared UI
const HOME_TOKENS = 3_500;
const PAGE_TOKENS = { marketing: 2_500, app: 3_800 } as const;
/** Extra per continuation unit: it re-emits imports/wiring for its pages. */
const UNIT_OVERHEAD = 800;

export interface SizeEstimate {
  kind: "marketing" | "app";
  shell: number;
  home: number;
  /** Per non-home route, in request order. */
  pages: Array<{ route: string; tokens: number }>;
  /** Cross-cutting extras (backend, auth, native) — land in unit 1. */
  extras: number;
  total: number;
}

const APP_SIGNAL =
  /\b(dashboard|admin|crud|login|sign ?in|sign ?up|auth|account|database|save|store data|booking system|checkout|cart|payments?|subscriptions?|kanban|tracker|inventory|crm|editor|upload|real-?time|chat|messages?|api)\b/i;

export function estimateFirstBuildSize(prompt: string, routes: string[]): SizeEstimate {
  const text = prompt.toLowerCase();
  const kind: SizeEstimate["kind"] = APP_SIGNAL.test(text) ? "app" : "marketing";
  let extras = 0;
  if (/\b(database|save|store data|backend|crud|records?)\b/.test(text)) extras += 2_500;
  if (/\b(login|sign ?in|sign ?up|auth|accounts?)\b/.test(text)) extras += 2_000;
  if (/\b(payments?|checkout|stripe|subscriptions?)\b/.test(text)) extras += 1_500;
  if (/\b(ios|android|app store|play store|native)\b/.test(text)) extras += 1_500;
  // Each named workflow (upload, drag, filter, calendar…) adds real code.
  const workflows = text.match(/\b(upload|drag|filter|search|calendar|chart|map|timer|notifications?|export|import)\b/g);
  extras += Math.min(4, workflows?.length ?? 0) * 700;
  const per = PAGE_TOKENS[kind];
  const pages = routes
    .filter((r) => r !== "/" && !r.includes("$"))
    .map((route) => ({ route, tokens: per }));
  const total = SHELL_TOKENS + HOME_TOKENS + extras + pages.reduce((n, p) => n + p.tokens, 0);
  return { kind, shell: SHELL_TOKENS, home: HOME_TOKENS, pages, extras, total };
}

export interface GenerationUnitPlan {
  /** Routes this unit writes (unit 1 also writes the shell + Home). */
  routes: string[];
  estimatedTokens: number;
}

export interface GenerationUnits {
  allRoutes: string[];
  unitCount: number;
  estimate: SizeEstimate;
  units: GenerationUnitPlan[];
  /** Budget every unit was planned against. */
  safeBudget: number;
  /** Prompt addendum for the FIRST unit; empty when one unit suffices. */
  instruction: string;
}

/**
 * Pack pages greedily into the fewest units that each stay under
 * SAFE_UNIT_BUDGET. Unit 1 carries the shell, Home and cross-cutting extras;
 * later units carry only pages. The remaining units are written by the
 * coverage continuation, which is told what is already done and never
 * regenerates delivered files.
 */
export function planUnits(est: SizeEstimate, budget: number = SAFE_UNIT_BUDGET): GenerationUnitPlan[] {
  const units: GenerationUnitPlan[] = [
    { routes: ["/"], estimatedTokens: est.shell + est.home + est.extras },
  ];
  for (const p of est.pages) {
    const cur = units[units.length - 1]!;
    if (cur.estimatedTokens + p.tokens <= budget) {
      cur.routes.push(p.route);
      cur.estimatedTokens += p.tokens;
    } else {
      units.push({ routes: [p.route], estimatedTokens: UNIT_OVERHEAD + p.tokens });
    }
  }
  return units;
}

export function buildGenerationUnits(
  prompt: string,
  plannedRoutes: string[],
  opts?: { maxOutputTokens?: number | null },
): GenerationUnits {
  const safeBudget = safeUnitBudget(opts?.maxOutputTokens);
  const all = [...plannedRoutes];
  for (const n of extractRequestedPages(prompt)) {
    const r = pageNameToRoute(n);
    if (!all.includes(r)) all.push(r);
  }
  const estimate = estimateFirstBuildSize(prompt, all);
  const units = planUnits(estimate, safeBudget);
  if (units.length <= 1) {
    return { allRoutes: all, unitCount: 1, estimate, units, safeBudget, instruction: "" };
  }
  const first = units[0]!.routes.filter((r) => r !== "/");
  const later = units.slice(1).flatMap((u) => u.routes);
  return {
    allRoutes: all,
    unitCount: units.length,
    estimate,
    units,
    safeBudget,
    instruction:
      `\n\n### Build in parts (this pass = part 1 of ${units.length})\n` +
      `This build is too large to write reliably in one pass.\n` +
      `In THIS pass write: the shared shell (router registering EVERY route: ${all.join(", ")}; navigation; footer; styles; shared components) plus the Home page` +
      (first.length ? ` and ONLY these pages: ${first.join(", ")}.\n` : ` only.\n`) +
      `Do NOT write these pages yet — the next pass writes them and will reuse your shell: ${later.join(", ")}.\n` +
      `Finish every file you start. Never stop mid-file.\n`,
  };
}
