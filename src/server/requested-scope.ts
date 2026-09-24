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
  "landing", "single", "one", "two", "three", "four", "five", "six", "seven",
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
  const text = prompt.replace(/\s+/g, " ");
  const found: string[] = [];
  const push = (raw: string) => {
    for (const part of raw.split(/,|\/|\band\b|\+|;/i)) {
      const n = cleanName(part);
      if (n && !found.includes(n)) found.push(n);
    }
  };

  // "pages: A, B and C" / "pages (A, B)" / "pages — A, B"
  for (const m of text.matchAll(/\bpages?\s*(?::|\(|—|-|including|include)\s*([^.!?\n)]{2,160})/gi)) {
    push(m[1]);
  }
  // "A, B, C and D pages"
  for (const m of text.matchAll(/((?:[A-Za-z][\w&-]*\s*(?:,|\band\b|\/|\+)\s*){1,9}[A-Za-z][\w&-]*)\s+pages\b/gi)) {
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
