/**
 * Document-head reconciliation — Quality Push A1.
 *
 * `index.html` is machine-owned. After the model sees it, Kimble rewrites it
 * several more times: the preview guard, the Kimble badge, the brand/favicon
 * injector and the renderable-shell restorer all append or rewrite markup.
 * By the time a `replace` op lands, the snippet the model copied is either
 * gone or now appears twice — which is exactly what telemetry shows: every
 * single `apply_ops` failure in the last three weeks was `index.html`, split
 * between "did not match" and "matched more than once".
 *
 * The fix is to stop treating index.html as a text file the model may patch.
 * Everything a model legitimately wants there is head metadata: the title, the
 * description, social tags, the theme colour, the favicon, a font stylesheet,
 * `lang`, and the dark-mode class on `<html>`. So we parse the *intent* out of
 * whatever the model emitted and merge it into the live document with a
 * deterministic writer. The op never reaches `applyOps`, so it can never fail.
 *
 * Pure string transforms — no DOM, no parser dependency (this runs in the
 * Worker), and deliberately conservative: anything we don't recognise as head
 * metadata is dropped rather than guessed at.
 */

import type { FileOp, ProjectFile } from "./generate.server";

const HTML_PATHS = new Set(["index.html", "public/index.html", "./index.html"]);

export interface HeadReconcileResult {
  files: ProjectFile[];
  /** The op list with every index.html op removed. */
  ops: FileOp[];
  notes: string[];
  /** How many ops were absorbed. */
  handled: number;
}

/* ---------------------------------------------------------------- intent -- */

interface HeadIntent {
  title?: string;
  /** keyed by `name:description` / `property:og:title` etc. */
  metas: Map<string, string>;
  /** keyed by rel (+href for stylesheets). */
  links: Map<string, string>;
  lang?: string;
  htmlClass?: string;
}

function emptyIntent(): HeadIntent {
  return { metas: new Map(), links: new Map() };
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? "";
}

/** Pull head metadata out of an arbitrary HTML fragment. */
export function readHeadIntent(fragment: string): HeadIntent {
  const intent = emptyIntent();
  if (!fragment) return intent;

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(fragment);
  if (title) {
    const text = title[1].replace(/\s+/g, " ").trim();
    if (text) intent.title = text;
  }

  for (const m of fragment.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, "name");
    const property = attr(tag, "property");
    const httpEquiv = attr(tag, "http-equiv");
    const charset = attr(tag, "charset");
    // charset / viewport / http-equiv are shell concerns; the shell owns them.
    if (charset !== undefined || httpEquiv !== undefined) continue;
    const key = property ? `property:${property.toLowerCase()}` : name ? `name:${name.toLowerCase()}` : "";
    if (!key) continue;
    if (key === "name:viewport") continue;
    intent.metas.set(key, tag);
  }

  for (const m of fragment.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, "rel") ?? "").toLowerCase().trim();
    if (!rel) continue;
    const href = attr(tag, "href") ?? "";
    // Only metadata-ish links. Never module/script preloads — those belong to
    // the bundler and copying them breaks the build.
    const allowed =
      rel === "icon" ||
      rel === "shortcut icon" ||
      rel === "apple-touch-icon" ||
      rel === "mask-icon" ||
      rel === "manifest" ||
      rel === "canonical" ||
      rel === "preconnect" ||
      rel === "dns-prefetch" ||
      rel === "stylesheet";
    if (!allowed) continue;
    if (rel === "stylesheet" && !/^https?:\/\//i.test(href)) continue; // local CSS is Vite's job
    const key = rel === "stylesheet" || rel === "preconnect" || rel === "dns-prefetch" ? `${rel}:${href}` : rel;
    intent.links.set(key, tag);
  }

  const htmlTag = /<html\b[^>]*>/i.exec(fragment);
  if (htmlTag) {
    const lang = attr(htmlTag[0], "lang");
    if (lang) intent.lang = lang;
    const cls = attr(htmlTag[0], "class");
    if (cls !== undefined) intent.htmlClass = cls;
  }

  return intent;
}

function mergeIntent(base: HeadIntent, extra: HeadIntent): HeadIntent {
  if (extra.title) base.title = extra.title;
  if (extra.lang) base.lang = extra.lang;
  if (extra.htmlClass !== undefined) base.htmlClass = extra.htmlClass;
  for (const [k, v] of extra.metas) base.metas.set(k, v);
  for (const [k, v] of extra.links) base.links.set(k, v);
  return base;
}

export function intentIsEmpty(i: HeadIntent): boolean {
  return !i.title && !i.lang && i.htmlClass === undefined && i.metas.size === 0 && i.links.size === 0;
}

/* ----------------------------------------------------------------- apply -- */

function ensureHead(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html;
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, "$1\n  <head>\n  </head>");
  }
  return `<head>\n</head>\n${html}`;
}

function insertIntoHead(html: string, tag: string): string {
  const close = /<\/head>/i.exec(html);
  if (!close) return `${html}\n${tag}`;
  return `${html.slice(0, close.index)}    ${tag}\n${html.slice(close.index)}`;
}

/** Merge a head intent into a real index.html. Deterministic and idempotent. */
export function applyHeadIntent(html: string, intent: HeadIntent): { html: string; changes: string[] } {
  let next = ensureHead(html);
  const changes: string[] = [];

  if (intent.title) {
    const escaped = intent.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (/<title[^>]*>[\s\S]*?<\/title>/i.test(next)) {
      const before = next;
      next = next.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`);
      if (before !== next) changes.push(`title → "${intent.title}"`);
    } else {
      next = insertIntoHead(next, `<title>${escaped}</title>`);
      changes.push(`title → "${intent.title}"`);
    }
  }

  for (const [key, tag] of intent.metas) {
    const [kind, value] = key.split(/:(.+)/);
    const rx = new RegExp(
      `<meta\\b[^>]*\\b${kind}\\s*=\\s*["']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    if (rx.test(next)) {
      const before = next;
      next = next.replace(rx, tag);
      if (before !== next) changes.push(`meta ${value}`);
    } else {
      next = insertIntoHead(next, tag);
      changes.push(`meta ${value}`);
    }
  }

  for (const [key, tag] of intent.links) {
    const rel = key.split(":")[0];
    const href = key.includes(":") ? key.slice(rel.length + 1) : "";
    const rx = href
      ? new RegExp(`<link\\b[^>]*href\\s*=\\s*["']${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i")
      : new RegExp(`<link\\b[^>]*\\brel\\s*=\\s*["']${rel}["'][^>]*>`, "i");
    if (rx.test(next)) {
      const before = next;
      next = next.replace(rx, tag);
      if (before !== next) changes.push(`link ${rel}`);
    } else {
      next = insertIntoHead(next, tag);
      changes.push(`link ${rel}`);
    }
  }

  if (intent.lang || intent.htmlClass !== undefined) {
    next = next.replace(/<html\b([^>]*)>/i, (whole, rawAttrs: string) => {
      let attrs = rawAttrs;
      if (intent.lang) {
        attrs = /\blang\s*=/.test(attrs)
          ? attrs.replace(/\blang\s*=\s*("[^"]*"|'[^']*')/i, `lang="${intent.lang}"`)
          : `${attrs} lang="${intent.lang}"`;
      }
      if (intent.htmlClass !== undefined) {
        attrs = /\bclass\s*=/.test(attrs)
          ? attrs.replace(/\bclass\s*=\s*("[^"]*"|'[^']*')/i, `class="${intent.htmlClass}"`)
          : `${attrs} class="${intent.htmlClass}"`;
      }
      return `<html${attrs.replace(/\s+$/, "")}>`;
    });
    changes.push("document element");
  }

  return { html: next, changes: Array.from(new Set(changes)) };
}

/* ------------------------------------------------------------ reconcile -- */

/**
 * Absorb every `index.html` op into a deterministic head merge.
 *
 * Returns the project with index.html already updated and an op list that no
 * longer contains anything targeting it — so the normal apply path can never
 * produce an `index.html` snippet-match failure again.
 */
export function reconcileDocumentHeadOps(files: ProjectFile[], ops: FileOp[]): HeadReconcileResult {
  const htmlOps = ops.filter((op) => HTML_PATHS.has(op.path));
  if (htmlOps.length === 0) return { files, ops, notes: [], handled: 0 };

  const remaining = ops.filter((op) => !HTML_PATHS.has(op.path));
  const idx = files.findIndex((f) => f.path === "index.html");
  const notes: string[] = [];

  // No document yet: a create/update op is the shell itself, so let it land
  // wholesale. The shell restorer owns everything after that.
  if (idx === -1) {
    const whole = htmlOps.find((op) => (op.op === "create" || op.op === "update") && "content" in op);
    if (whole && "content" in whole && typeof whole.content === "string") {
      return {
        files: [...files, { path: "index.html", content: whole.content }],
        ops: remaining,
        notes: ["document-head: created index.html from the model's shell"],
        handled: htmlOps.length,
      };
    }
    return { files, ops: remaining, notes: ["document-head: dropped index.html op (no document to patch)"], handled: htmlOps.length };
  }

  let intent = emptyIntent();
  for (const op of htmlOps) {
    if (op.op === "delete") continue;
    const fragment =
      op.op === "replace" ? op.replace : "content" in op && typeof op.content === "string" ? op.content : "";
    intent = mergeIntent(intent, readHeadIntent(fragment));
  }

  if (intentIsEmpty(intent)) {
    return {
      files,
      ops: remaining,
      notes: [
        `document-head: ignored ${htmlOps.length} index.html edit(s) with no head metadata — index.html is managed by Kimble`,
      ],
      handled: htmlOps.length,
    };
  }

  const { html, changes } = applyHeadIntent(files[idx].content, intent);
  const nextFiles =
    html === files[idx].content
      ? files
      : files.map((f, i) => (i === idx ? { ...f, content: html } : f));

  notes.push(
    changes.length > 0
      ? `document-head: merged ${changes.join(", ")} into index.html`
      : "document-head: index.html already matched the requested metadata",
  );

  return { files: nextFiles, ops: remaining, notes, handled: htmlOps.length };
}
