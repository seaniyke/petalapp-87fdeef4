/**
 * Deterministic screen/section target finder.
 *
 * "Add a line under the sign-in form", "change the heading on the home page"
 * name WHERE the change goes in plain words. Matching those words against real
 * page/section file names finds the target without an AI call. Only app-owned
 * pages and sections are considered; starter-kit folders never match.
 */

const SCREEN_PHRASE =
  /\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)\s+(page|screen|form|section|modal|dialog)\b/gi;
const SECTION_WORDS = [
  "hero", "header", "nav", "navbar", "footer", "pricing", "faq", "features", "testimonials",
  "cta", "showcase", "contact", "about", "signin", "signup", "login", "dashboard", "settings",
];
const STOP = new Set(["the", "this", "that", "my", "our", "a", "an", "main", "whole", "same", "new", "on", "in", "below", "under", "above"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, string[]> = {
  home: ["home", "index", "landing"],
  landing: ["landing", "home", "index"],
  signin: ["signin", "login"],
  login: ["login", "signin"],
  signup: ["signup", "register"],
  nav: ["nav", "siteheader", "header"],
  navbar: ["nav", "siteheader", "header"],
  header: ["siteheader", "header", "nav"],
};

function isAppOwned(path: string): boolean {
  return /^src\/(pages|routes|components\/sections|components\/[A-Z][^/]*\.tsx$)/.test(path) ||
    /^src\/pages\//.test(path) || /^src\/routes\//.test(path);
}

export function findScreenTargets(prompt: string, paths: string[]): string[] {
  const text = (prompt ?? "").toLowerCase();
  const wanted = new Set<string>();
  for (const m of text.matchAll(SCREEN_PHRASE)) {
    const words = m[1].split(/\s+/).filter((w) => !STOP.has(w));
    if (words.length) wanted.add(norm(words.join("")));
    const last = words[words.length - 1];
    if (last) wanted.add(norm(last));
  }
  for (const w of SECTION_WORDS) if (new RegExp(`\\b${w}\\b`).test(text.replace(/-/g, ""))) wanted.add(w);
  if (wanted.size === 0) return [];

  const keys = new Set<string>();
  for (const w of wanted) for (const k of ALIASES[w] ?? [w]) if (k.length >= 3) keys.add(k);

  const candidates = paths.filter(isAppOwned);
  const hits: Array<{ path: string; score: number }> = [];
  for (const p of candidates) {
    const base = norm(p.split("/").pop()!.replace(/\.(t|j)sx?$/, "").replace(/(page|section|screen)$/i, ""));
    for (const k of keys) {
      if (base === k || base.startsWith(k)) {
        hits.push({ path: p, score: (base === k ? 2 : 1) + (p.startsWith("src/pages/") ? 1 : 0) });
        break;
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 3).map((h) => h.path);
}
