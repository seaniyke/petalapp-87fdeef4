/**
 * Content edits: change words, items, prices, names and contact details
 * where they already live.
 *
 * A request like "remove X from every page, add Y at ₦14,000, rename the
 * business, show this phone number" is not a redesign. It used to be treated
 * as one (every page pinned, whole-file `update` ops demanded), which made a
 * medium edit read ~300k tokens and overflow its answer. Here we:
 *   - recognise a content-only edit deterministically,
 *   - find the files that actually hold the content (literal phrases, the
 *     current brand name, price lists, contact details, data files),
 *   - tell the model to patch those lines in place, and
 *   - turn any small whole-file `update` of an existing file back into exact
 *     `replace` ops (verified to reproduce the same result).
 */
import type { FileOp, ProjectFile } from "./generate.server";

const DESIGN_RE =
  /\b(design|redesign|re-?style|restyle|theme|re-?theme|colou?rs?|palette|font|fonts|typography|layout|look(?:\s+and\s+feel)?|style|styling|responsive|mobile[-\s]?friendly|spacing|padding|margin|animations?|dark\s+mode|light\s+mode|background|gradient|shadow)\b/i;
const NEW_SURFACE_RE =
  /\b(add|create|build|make|new)\b[^.!?]{0,40}\b(pages?|screens?|routes?|dashboard)\b|\b(database|login|log in|sign ?up|sign ?in|auth|payments?|checkout|api|backend)\b/i;
const CONTENT_VERB_RE = /\b(remove|delete|drop|take\s+out|rename|change|replace|update|swap|add|show|display|list|set|correct|fix)\b/i;
const CONTENT_TARGET_RE =
  /\b(price[sd]?|pricing|cost|menu|items?|dish(?:es)?|meals?|services?|products?|phone|number|whatsapp|e-?mail|address|hours|opening|name|business|brand|title|text|copy|wording|headline|label|contact|faq)\b|[₦$€£]\s?\d|\+?\d[\d\s()-]{7,}\d|wa\.me|tel:|mailto:/i;

/** True for an edit that only changes content (items, prices, names, contacts). */
export function isContentOnlyEdit(prompt: string): boolean {
  const text = (prompt ?? "").slice(0, 4000);
  if (!text.trim()) return false;
  if (DESIGN_RE.test(text) || NEW_SURFACE_RE.test(text)) return false;
  return CONTENT_VERB_RE.test(text) && CONTENT_TARGET_RE.test(text);
}

const PRICE_RE = /[₦$€£]\s?\d|\b(price[sd]?|pricing|cost|NGN|naira)\b/i;
const PHONE_RE = /\+?\d[\d\s()-]{7,}\d|\b(phone|whatsapp|call|number|tel)\b|wa\.me/i;
const EMAIL_RE = /\b(e-?mail|mailto)\b|[\w.+-]+@[\w-]+\.[\w.]+/i;
const ADDRESS_RE = /\b(address|location|located)\b/i;
const RENAME_BRAND_RE = /\b(rename|change|call)\b[^.!?]{0,30}\b(business|brand|company|site|website|restaurant|shop|store|name)\b/i;

/** Phrases the user names as the thing to remove / rename / replace. */
export function extractNamedPhrases(prompt: string): string[] {
  const out = new Set<string>();
  for (const m of prompt.matchAll(/["“'‘]([^"”'’\n]{2,60})["”'’]/g)) out.add(m[1].trim());
  const objectRe =
    /\b(?:remove|delete|drop|take\s+out|rename|replace|change)\s+(?:the\s+)?(.{2,120}?)(?=\s+(?:from|to|with|in|on|at|everywhere|across)\b|[.!?;\n]|$)/gi;
  for (const m of prompt.matchAll(objectRe)) {
    for (const part of m[1].split(/\s*(?:,|\band\b|&)\s*/i)) {
      const phrase = part.trim().replace(/^(?:the|a|an|our|my)\s+/i, "");
      if (phrase.length < 3 || /^(business|brand|name|site|website|item|items|it|them|this|that)$/i.test(phrase)) continue;
      out.add(phrase);
    }
  }
  return [...out].slice(0, 12);
}

/** The project's current brand name, from the page title or a site config. */
export function currentBrandName(files: ProjectFile[]): string | null {
  const html = files.find((f) => f.path === "index.html")?.content ?? "";
  const title = /<title>([^<]{2,80})<\/title>/i.exec(html)?.[1];
  const fromTitle = title?.split(/\s[|–—-]\s|\s·\s/)[0]?.trim();
  if (fromTitle && fromTitle.length >= 2 && !/^(vite|react|app|lovable)/i.test(fromTitle)) return fromTitle;
  for (const f of files) {
    if (!/src\/(lib|config|data)\/[^/]*(site|brand|config|business)[^/]*\.(t|j)sx?$/i.test(f.path)) continue;
    const m = /\b(?:name|brandName|businessName|siteName)\s*:\s*["'`]([^"'`\n]{2,60})["'`]/.exec(f.content);
    if (m) return m[1].trim();
  }
  return null;
}

const SCAFFOLD_RE = /^src\/(components\/(ui|blocks|examples|mobile)\/|integrations\/)/;
const DATA_FILE_RE =
  /^src\/(data\/|content\/|config\/|lib\/[^/]*(site|config|content|data|menu|brand|contact|business|constants?)[^/]*\.(t|j)sx?$)/i;
const SOURCE_RE = /\.(tsx?|jsx?|json|html|md)$/;

export interface ContentEditPlan {
  /** Files that hold the content the request changes, most certain first. */
  paths: string[];
  phrases: string[];
  brand: string | null;
}

/**
 * Locate the files a content edit touches. Returns null when the request is
 * not a content-only edit or nothing could be located (callers then keep
 * their normal context selection).
 */
export function planContentEdit(prompt: string, files: ProjectFile[], maxFiles = 16): ContentEditPlan | null {
  if (!isContentOnlyEdit(prompt)) return null;
  const owned = files.filter((f) => SOURCE_RE.test(f.path) && !SCAFFOLD_RE.test(f.path) && f.path !== "package.json");
  const phrases = extractNamedPhrases(prompt);
  const brand = RENAME_BRAND_RE.test(prompt) ? currentBrandName(files) : null;
  const score = new Map<string, number>();
  const bump = (path: string, n: number) => score.set(path, (score.get(path) ?? 0) + n);
  for (const f of owned) {
    const lower = f.content.toLowerCase();
    for (const p of phrases) if (lower.includes(p.toLowerCase())) bump(f.path, 10);
    if (brand && f.content.includes(brand)) bump(f.path, 8);
    if (PRICE_RE.test(prompt) && /[₦$€£]\s?\d|\bprice\s*:/i.test(f.content)) bump(f.path, 4);
    if (PHONE_RE.test(prompt) && /tel:|wa\.me|whatsapp|\bphone\b/i.test(f.content)) bump(f.path, 4);
    if (EMAIL_RE.test(prompt) && /mailto:|\bemail\b/i.test(f.content)) bump(f.path, 3);
    if (ADDRESS_RE.test(prompt) && /\baddress\b/i.test(f.content)) bump(f.path, 3);
    if (DATA_FILE_RE.test(f.path)) bump(f.path, 2);
  }
  const paths = [...score.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFiles)
    .map(([p]) => p);
  if (paths.length === 0) return null;
  return { paths, phrases, brand };
}

/** Prompt block for a content edit: patch in place, never re-send files. */
export function contentEditAddendum(plan: ContentEditPlan): string {
  const lines = [
    "",
    "",
    "This is a CONTENT edit — change words, items, prices, names and contact details exactly where they already live.",
    "Rules for this turn:",
    "1. For every EXISTING file, use `replace` ops that quote the exact lines to change (menu/service arrays, price fields, contact constants, names). Never re-send an existing file with `update`. Use `create` only for a genuinely new file.",
    "2. Do not add new sections, components or pages. Edit content where it already is.",
    "3. Removing an item means removing it from every file below that contains it (data arrays, cards, navigation, footer, page titles and descriptions).",
    "4. Handle every clause of the request. Keep each `replace` small — one per region.",
    "5. In your recap, give one bullet per requested change.",
    `Files that hold this content: ${plan.paths.join(", ")}.`,
  ];
  if (plan.phrases.length) lines.push(`Named content to find: ${plan.phrases.map((p) => `"${p}"`).join(", ")}.`);
  if (plan.brand) lines.push(`The current business name is "${plan.brand}" — rename every occurrence the request covers.`);
  return lines.join("\n");
}

// ───────────────────────── update → replace conversion ─────────────────────

const MAX_DIFF_LINES = 2_000;
const MAX_SEARCH_LINES = 120;

/** Line hunks between a and b, via LCS over the middle (after common prefix/suffix). */
function lineHunks(a: string[], b: string[]): Array<{ a0: number; a1: number; b0: number; b1: number }> | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (A.length > MAX_DIFF_LINES || B.length > MAX_DIFF_LINES) return null;
  const n = A.length, m = B.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = A[i] === B[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const hunks: Array<{ a0: number; a1: number; b0: number; b1: number }> = [];
  let i = 0, j = 0;
  let open: { a0: number; b0: number } | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      if (open) { hunks.push({ a0: open.a0 + pre, a1: i + pre, b0: open.b0 + pre, b1: j + pre }); open = null; }
      i++; j++;
    } else {
      if (!open) open = { a0: i, b0: j };
      if (j < m && (i >= n || dp[i * (m + 1) + j + 1] >= dp[(i + 1) * (m + 1) + j])) j++;
      else i++;
    }
  }
  if (open) hunks.push({ a0: open.a0 + pre, a1: n + pre, b0: open.b0 + pre, b1: m + pre });
  return hunks;
}

/**
 * Exact `replace` ops that turn `prev` into `next`, or null when that can't
 * be done safely (too many changes, ambiguous anchors, huge files). The ops
 * are verified by re-applying them before they are returned.
 */
export function diffToReplaceOps(path: string, prev: string, next: string): Array<{ op: "replace"; path: string; search: string; replace: string }> | null {
  if (prev === next) return [];
  const a = prev.split("\n");
  const b = next.split("\n");
  const hunks = lineHunks(a, b);
  if (!hunks || hunks.length === 0) return null;
  const changed = hunks.reduce((n, h) => n + Math.max(h.a1 - h.a0, h.b1 - h.b0), 0);
  if (changed > Math.max(4, a.length * 0.4)) return null;
  const ops: Array<{ op: "replace"; path: string; search: string; replace: string }> = [];
  let working = prev;
  // Apply bottom-up so earlier line numbers stay valid in `a`.
  for (const h of [...hunks].reverse()) {
    let done = false;
    for (let ctx = 1; ctx <= 8 && !done; ctx++) {
      const s0 = Math.max(0, h.a0 - ctx);
      const s1 = Math.min(a.length, h.a1 + ctx);
      if (s1 - s0 > MAX_SEARCH_LINES) break;
      const search = a.slice(s0, s1).join("\n");
      if (!search.trim()) continue;
      const first = working.indexOf(search);
      if (first < 0 || first !== working.lastIndexOf(search)) continue;
      const replace = [...a.slice(s0, h.a0), ...b.slice(h.b0, h.b1), ...a.slice(h.a1, s1)].join("\n");
      working = working.slice(0, first) + replace + working.slice(first + search.length);
      ops.unshift({ op: "replace", path, search, replace });
      done = true;
    }
    if (!done) return null;
  }
  // Verify forward application reproduces `next` exactly.
  let check = prev;
  for (const op of ops) {
    const at = check.indexOf(op.search);
    if (at < 0 || at !== check.lastIndexOf(op.search)) return null;
    check = check.slice(0, at) + op.replace + check.slice(at + op.search.length);
  }
  return check === next ? ops : null;
}

/**
 * Content-edit turns: turn whole-file `update` ops on existing files into
 * the equivalent exact `replace` ops. Updates that can't be converted safely
 * are left as they are (the normal applier gates still judge them).
 */
export function updatesToReplaceOps(ops: FileOp[], currentFiles: ProjectFile[]): { ops: FileOp[]; converted: string[] } {
  const byPath = new Map(currentFiles.map((f) => [f.path, f.content]));
  const out: FileOp[] = [];
  const converted: string[] = [];
  for (const op of ops) {
    if (op.op === "update" && byPath.has(op.path)) {
      const prev = byPath.get(op.path)!;
      const replaces = diffToReplaceOps(op.path, prev, op.content);
      if (replaces && replaces.length > 0) {
        out.push(...replaces);
        converted.push(op.path);
        byPath.set(op.path, op.content);
        continue;
      }
      if (replaces && replaces.length === 0) continue; // unchanged file: no-op write dropped
    }
    out.push(op);
    if ((op.op === "update" || op.op === "create") && "content" in op) byPath.set(op.path, op.content);
    if (op.op === "replace" && byPath.has(op.path)) {
      const cur = byPath.get(op.path)!;
      if (cur.includes(op.search)) byPath.set(op.path, cur.replace(op.search, op.replace));
    }
  }
  return { ops: out, converted };
}
