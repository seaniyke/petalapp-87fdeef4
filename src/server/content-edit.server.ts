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

const NEW_SURFACE_RE =
  /\b(add|create|build|make|new)\b[^.!?]{0,40}\b(pages?|screens?|routes?|dashboard)\b|\b(database|login|log in|sign ?up|sign ?in|auth|payments?|checkout|api|backend)\b/i;
const CONTENT_VERB_RE = /\b(remove|delete|drop|take\s+out|rename|change|replace|update|swap|add|show|display|list|set|correct|fix)\b/i;
const CONTENT_TARGET_RE =
  /\b(price[sd]?|pricing|cost|menu|items?|dish(?:es)?|meals?|services?|products?|phone|number|whatsapp|e-?mail|address|hours|opening|name|business|brand|title|text|copy|wording|headline|label|contact|faq)\b|[₦$€£]\s?\d|\+?\d[\d\s()-]{7,}\d|wa\.me|tel:|mailto:/i;

/** True for an edit that only changes content (items, prices, names, contacts). */
export function isContentOnlyEdit(prompt: string): boolean {
  return isContentOnlyChange(prompt);
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
  prompt = changeSection(prompt);
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
export function contentEditAddendum(plan: ContentEditPlan, alreadyDone: string[] = []): string {
  const lines = [
    "",
    "",
    "This is a CONTENT edit — change words, items, prices, names and contact details exactly where they already live.",
    "Rules for this turn:",
    "1. Use ONLY `replace` ops that quote the exact lines to change (menu/service arrays, price fields, contact constants). NEVER use `update` on an existing file. Use `create` only for a genuinely new file.",
    "2. Do not add new sections, components or pages. Edit content where it already is.",
    "3. Removing an item means removing it from every file below that contains it (data arrays, cards, navigation, footer, page titles and descriptions).",
    "4. Handle every clause of the request. Keep each `replace` small — one per region.",
    "5. In your recap, give one bullet per requested change.",
    `Files that hold this content: ${plan.paths.join(", ")}.`,
  ];
  if (plan.phrases.length) lines.push(`Named content to find: ${plan.phrases.map((p) => `"${p}"`).join(", ")}.`);
  if (alreadyDone.length) lines.push(`ALREADY APPLIED automatically (do NOT emit ops for these; the files above still show the old text): ${alreadyDone.join("; ")}. Do only the remaining changes.`);
  if (plan.brand && !alreadyDone.some((d) => d.startsWith("renamed"))) lines.push(`The current business name is "${plan.brand}" — rename every occurrence the request covers.`);
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

// ───────────────────── partner prompts: classify only the change ───────────

/**
 * Partner prompts carry standing context (build rules, business facts, "in
 * the same style"). Only the text under a "# The change" heading decides the
 * edit type; without that heading the whole prompt is used.
 */
export function changeSection(prompt: string): string {
  const text = prompt ?? "";
  const m = /^#{1,6}\s*the\s+change\b[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im.exec(text);
  return m ? m[1].trim() : text;
}

/** Design words count only when they are the thing being changed. */
const DESIGN_CHANGE_RE = new RegExp(
  String.raw`\b(redesign|re-?style|restyle|re-?theme)\b|\b(change|make|update|switch|use|new|different|darker|lighter|bigger|smaller|improve|modernize|modernise)\b[^.!?\n]{0,30}\b(design|theme|colou?rs?|palette|fonts?|typography|layout|look(?:\s+and\s+feel)?|style|styling|spacing|padding|margin|animations?|dark\s+mode|light\s+mode|background|gradient|shadow)\b`,
  "i",
);
const KEEP_STYLE_RE = /\b(keep|same|existing|current|match(?:ing)?|in\s+the\s+same)\b[^.!?\n]{0,25}\b(style|design|look|theme|colou?rs?|fonts?|layout)\b/gi;

export function isContentOnlyChange(prompt: string): boolean {
  const text = changeSection(prompt).slice(0, 4000);
  if (!text.trim()) return false;
  const stripped = text.replace(KEEP_STYLE_RE, " ");
  if (DESIGN_CHANGE_RE.test(stripped) || NEW_SURFACE_RE.test(stripped)) return false;
  return CONTENT_VERB_RE.test(stripped) && CONTENT_TARGET_RE.test(stripped);
}

// ─────────────────── deterministic renames and removals ───────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "rename … to NEW …, replacing "OLD"" / "rename "OLD" to "NEW"". */
export function extractRename(prompt: string, brand: string | null): { from: string; to: string } | null {
  const text = changeSection(prompt);
  const q = `["“'‘]`, qe = `["”'’]`;
  let m = new RegExp(`\\brename\\s+${q}([^"”'’\\n]{2,80})${qe}\\s+to\\s+${q}?([^"”\\n]{2,80}?)${qe}?(?=\\s+everywhere\\b|[,.;\\n]|$)`, "i").exec(text);
  if (m) return { from: m[1].trim(), to: m[2].trim() };
  m = /\brename\b[^.\n]{0,40}?\bto\s+["“]?(.{2,80}?)["”]?(?=\s+everywhere\b|\s*,|\.\s|\.$|;|\n|\s+replacing\b|$)/i.exec(text);
  if (!m) return null;
  const to = m[1].trim();
  const om = /\b(?:replacing|instead\s+of|from)\s+(?:["“]([^"”\n]{2,80})["”]|[‘']([^’'\n]{2,80})[’'](?!\w))/i.exec(text);
  const old = (om?.[1] ?? om?.[2])?.trim() ?? brand;
  if (!old || old === to) return null;
  return { from: old, to };
}

/** Items named after "remove/delete … from" (quoted or plain list). */
export function extractRemovals(prompt: string): string[] {
  const text = changeSection(prompt);
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:remove|delete|drop|take\s+out)\s+(?:the\s+)?(.{2,160}?)(?=\s+(?:from|everywhere|across)\b|[.;\n]|$)/gi)) {
    for (const part of m[1].split(/\s*(?:,|\band\b)\s*/i)) {
      const p = part.trim().replace(/^["“'‘]|["”'’]$/g, "").replace(/^(?:the|a|an|our|my)\s+/i, "").trim();
      if (p.length >= 3 && !/^(it|them|this|that|items?|section|page)$/i.test(p)) out.add(p);
    }
  }
  return [...out];
}

/** Remove array entries (string or object) whose name is exactly `phrase`. */
function removeEntry(content: string, phrase: string): string {
  const lines = content.split("\n");
  const lit = new RegExp(`["'\`]${escapeRe(phrase)}["'\`]`, "i");
  for (let guard = 0; guard < 20; guard++) {
    const idx = lines.findIndex((l) => lit.test(l));
    if (idx < 0) break;
    const line = lines[idx];
    const t = line.trim();
    let start = -1, end = -1;
    if (new RegExp(`^["'\`]${escapeRe(phrase)}["'\`],?$`, "i").test(t) || /^\{[^{}]*\},?$/.test(t)) {
      start = end = idx;
    } else {
      // enclosing multi-line object literal { … } of at most 20 lines
      let depth = 0;
      for (let i = idx; i >= Math.max(0, idx - 20); i--) {
        const s = lines[i];
        depth += (s.match(/\}/g) ?? []).length - (s.match(/\{/g) ?? []).length;
        if (i !== idx && depth < 0 && /^\s*\{\s*$/.test(s)) { start = i; break; }
        if (depth < -1) break;
      }
      if (start >= 0) {
        let d = 0;
        for (let i = start; i < Math.min(lines.length, start + 25); i++) {
          d += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
          if (d === 0) { if (/^\s*\},?\s*$/.test(lines[i])) end = i; break; }
        }
      }
    }
    if (start < 0 || end < 0) break; // not a removable entry: leave it to the model
    lines.splice(start, end - start + 1);
  }
  return lines.join("\n");
}

export interface DeterministicContent {
  ops: Array<{ op: "replace"; path: string; search: string; replace: string }>;
  done: string[];
  /** Removal phrases that still appear somewhere after the deterministic pass. */
  leftover: string[];
}

/**
 * Renames and removals of literal text, applied as exact verified replace ops
 * across the content files — no model rewrite needed.
 */
export function deterministicContentOps(prompt: string, files: ProjectFile[], plan: ContentEditPlan): DeterministicContent {
  const rename = extractRename(prompt, plan.brand ?? currentBrandName(files));
  const removals = extractRemovals(prompt);
  const owned = files.filter((f) => SOURCE_RE.test(f.path) && !SCAFFOLD_RE.test(f.path) && f.path !== "package.json");
  const ops: DeterministicContent["ops"] = [];
  const done = new Set<string>();
  const leftover = new Set<string>();
  for (const f of owned) {
    let next = f.content;
    if (rename && next.includes(rename.from)) {
      next = next.split(rename.from).join(rename.to);
      done.add(`renamed "${rename.from}" to "${rename.to}"`);
    }
    for (const r of removals) {
      const after = removeEntry(next, r);
      if (after !== next) done.add(`removed "${r}"`);
      next = after;
      if (next.toLowerCase().includes(r.toLowerCase())) leftover.add(r);
    }
    if (next === f.content) continue;
    const replaces = diffToReplaceOps(f.path, f.content, next) ?? spanReplace(f.path, f.content, next);
    if (replaces) ops.push(...replaces);
  }
  return { ops, done: [...done], leftover: [...leftover] };
}

/** Apply replace ops in order; returns the ops that still matched. */
export function mergeContentOps(det: FileOp[], model: FileOp[], currentFiles: ProjectFile[]): { ops: FileOp[]; dropped: number } {
  const state = new Map(currentFiles.map((f) => [f.path, f.content]));
  const out: FileOp[] = [];
  let dropped = 0;
  for (const op of [...det, ...model]) {
    if (op.op === "replace") {
      const cur = state.get(op.path);
      if (cur == null || !cur.includes(op.search)) { dropped++; continue; }
      state.set(op.path, cur.replace(op.search, op.replace));
    } else if ((op.op === "update" || op.op === "create") && "content" in op) {
      state.set(op.path, op.content);
    }
    out.push(op);
  }
  return { ops: out, dropped };
}

/** Every complete replace/create op already present in a (possibly cut-off) answer. */
export function salvageCompleteOps(rawArgs: string): FileOp[] {
  const at = rawArgs.indexOf('"ops"');
  if (at < 0) return [];
  const open = rawArgs.indexOf("[", at);
  if (open < 0) return [];
  const out: FileOp[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = open + 1; i < rawArgs.length; i++) {
    const c = rawArgs[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const op = JSON.parse(rawArgs.slice(start, i + 1));
          if (op && (op.op === "replace" && typeof op.search === "string" && typeof op.replace === "string" || op.op === "create" && typeof op.content === "string") && typeof op.path === "string") out.push(op);
        } catch { /* incomplete */ }
        start = -1;
      }
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

/** One replace covering the changed line span, widened until its search text is unique. */
function spanReplace(path: string, prev: string, next: string): Array<{ op: "replace"; path: string; search: string; replace: string }> | null {
  const a = prev.split("\n"), b = next.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  for (let pad = 0; pad <= a.length; pad++) {
    const lo = Math.max(0, pre - pad), hiA = Math.min(a.length, a.length - suf + pad), hiB = b.length - (a.length - hiA);
    const search = a.slice(lo, hiA).join("\n");
    if (!search) continue;
    if (prev.indexOf(search) !== prev.lastIndexOf(search)) continue;
    const replace = b.slice(lo, hiB).join("\n");
    const at = prev.indexOf(search);
    if (prev.slice(0, at) + replace + prev.slice(at + search.length) !== next) return null;
    return [{ op: "replace", path, search, replace }];
  }
  return null;
}
