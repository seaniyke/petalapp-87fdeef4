/**
 * Deterministic application of a design-system package. Pure:
 * ProjectFile[] in → ProjectFile[] out. No AI, no network.
 *
 * - tokens + accent: one marked block appended to the stylesheet (after the
 *   project's own :root so it wins), replaced in place on re-apply.
 * - fonts: a marked region inside the root route's `links: [` array.
 * - components: copied to src/components/design-system/<slug>/.
 *
 * Same input → identical output. If anything cannot be applied the whole
 * result is an error and no file is returned, so a caller never saves a
 * half-transformed project.
 */
import type { ProjectFile } from "@/server/generate.server";
import { isValidAccent, type DesignSystemPackage } from "./loader";

export const TOKENS_START = "/* petal-design-system:start */";
export const TOKENS_END = "/* petal-design-system:end */";
export const FONTS_START = "/* petal-fonts:start */";
export const FONTS_END = "/* petal-fonts:end */";
export const HTML_FONTS_START = "<!-- petal-fonts:start -->";
export const HTML_FONTS_END = "<!-- petal-fonts:end -->";

/** Markers written by older builds; recognised and replaced on re-apply. */
const LEGACY: Record<string, string> = {
  [TOKENS_START]: "/* kimble-design-system:start */",
  [TOKENS_END]: "/* kimble-design-system:end */",
  [FONTS_START]: "/* kimble-fonts:start */",
  [FONTS_END]: "/* kimble-fonts:end */",
  [HTML_FONTS_START]: "<!-- kimble-fonts:start -->",
  [HTML_FONTS_END]: "<!-- kimble-fonts:end -->",
};

/** Position of a marker, accepting the legacy spelling. */
export function markerIndex(src: string, marker: string): number {
  const i = src.indexOf(marker);
  return i >= 0 ? i : LEGACY[marker] ? src.indexOf(LEGACY[marker]) : -1;
}

/** True when the stylesheet carries a design-system token block (current or legacy markers). */
export function hasTokenBlock(css: string): boolean {
  return markerIndex(css, TOKENS_START) >= 0;
}

const STYLE_PATHS = ["src/styles.css", "src/index.css"];
const ROOT_PATH = "src/routes/__root.tsx";
const HTML_PATH = "index.html";


export type ApplyResult =
  | { ok: true; files: ProjectFile[]; changedPaths: string[]; changed: boolean }
  | { ok: false; error: string };

function block(selector: string, decls: Record<string, string>): string {
  const lines = Object.entries(decls).map(([k, v]) => `  --${k}: ${v};`);
  return lines.length ? `${selector} {\n${lines.join("\n")}\n}` : "";
}

export function renderTokenBlock(pkg: DesignSystemPackage, accent: string): string {
  const a = pkg.accents[accent]!;
  return [
    TOKENS_START,
    `/* ${pkg.meta.slug}@${pkg.meta.version} accent=${accent} — managed by Petal; edit the package, not this block */`,
    pkg.tokensCss.trim(),
    block(":root", a.light),
    a.dark ? block(".dark", a.dark) : "",
    TOKENS_END,
  ].filter(Boolean).join("\n");
}

function replaceRegion(src: string, start: string, end: string, body: string): string | null {
  const s = markerIndex(src, start);
  const e = markerIndex(src, end);
  if (s < 0 && e < 0) return null;
  if (s < 0 || e < s) return null; // corrupted markers
  const endLen = src.startsWith(end, e) ? end.length : (LEGACY[end] ?? end).length;
  return src.slice(0, s) + body + src.slice(e + endLen);
}

export function applyTokens(css: string, pkg: DesignSystemPackage, accent: string): string {
  const body = renderTokenBlock(pkg, accent);
  const replaced = replaceRegion(css, TOKENS_START, TOKENS_END, body);
  if (replaced !== null) return replaced;
  return `${css.replace(/\s*$/, "")}\n\n${body}\n`;
}

export function renderFontLinks(pkg: DesignSystemPackage): string {
  const items = pkg.fonts.map((f) =>
    `{ rel: ${JSON.stringify(f.rel)}, href: ${JSON.stringify(f.href)}${f.crossOrigin ? ', crossOrigin: "anonymous"' : ""} },`,
  );
  return `${FONTS_START}\n      ${items.join("\n      ")}\n      ${FONTS_END}`;
}

export function applyFonts(rootSrc: string, pkg: DesignSystemPackage): string | null {
  const body = renderFontLinks(pkg);
  const replaced = replaceRegion(rootSrc, FONTS_START, FONTS_END, body);
  if (replaced !== null) return replaced;
  const m = /links:\s*\[/.exec(rootSrc);
  if (!m) return null;
  const at = m.index + m[0].length;
  return `${rootSrc.slice(0, at)}\n      ${body}${rootSrc.slice(at)}`;
}

/** Raw `<link>` tags for a plain Vite `index.html`, inside HTML markers. */
export function renderHtmlFontLinks(pkg: DesignSystemPackage): string {
  const tags = pkg.fonts.map(
    (f) => `    <link rel="${f.rel}" href="${f.href}"${f.crossOrigin ? " crossorigin" : ""}>`,
  );
  return [`    ${HTML_FONTS_START}`, ...tags, `    ${HTML_FONTS_END}`].join("\n").trimStart();
}


/**
 * Install the font links into a Vite `index.html`. Replaces the marked region
 * when present, otherwise inserts it immediately before `</head>`.
 */
export function applyHtmlFonts(html: string, pkg: DesignSystemPackage): string | null {
  const body = renderHtmlFontLinks(pkg);
  const replaced = replaceRegion(html, HTML_FONTS_START, HTML_FONTS_END, body);
  if (replaced !== null) return replaced;
  const at = html.search(/<\/head>/i);
  if (at < 0) return null;
  return `${html.slice(0, at)}${body}\n  ${html.slice(at)}`;
}

export function applyDesignSystem(files: ProjectFile[], pkg: DesignSystemPackage, accent: string): ApplyResult {
  if (!isValidAccent(pkg, accent)) return { ok: false, error: `accent "${accent}" does not belong to ${pkg.meta.slug}` };
  const styles = STYLE_PATHS.map((p) => files.find((f) => f.path === p)).find(Boolean);
  if (!styles) return { ok: false, error: "project has no stylesheet (src/styles.css)" };

  // Fonts go wherever this project keeps its document head: the TanStack root
  // route when there is one, otherwise the Vite index.html that generated SPAs
  // actually ship. Requiring __root.tsx meant no generated app ever got fonts.
  const updates = new Map<string, string>();
  const root = files.find((f) => f.path === ROOT_PATH);
  const html = files.find((f) => f.path === HTML_PATH);
  if (root) {
    const nextRoot = applyFonts(root.content, pkg);
    if (nextRoot === null) return { ok: false, error: "could not find a head links array to install fonts into" };
    updates.set(root.path, nextRoot);
  } else if (html) {
    const nextHtml = applyHtmlFonts(html.content, pkg);
    if (nextHtml === null) return { ok: false, error: "index.html has no </head> to install fonts into" };
    updates.set(html.path, nextHtml);
  } else {
    return { ok: false, error: `project has neither ${ROOT_PATH} nor ${HTML_PATH}` };
  }

  updates.set(styles.path, applyTokens(styles.content, pkg, accent));

  for (const [rel, content] of Object.entries(pkg.components)) {
    updates.set(`src/components/design-system/${pkg.meta.slug}/${rel}`, content);
  }

  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const changedPaths: string[] = [];
  for (const [p, c] of updates) if (byPath.get(p)?.content !== c) changedPaths.push(p);
  const out = files.map((f) => (updates.has(f.path) ? { ...f, content: updates.get(f.path)! } : f));
  for (const [p, c] of updates) if (!byPath.has(p)) out.push({ path: p, content: c } as ProjectFile);
  return { ok: true, files: out, changedPaths: changedPaths.sort(), changed: changedPaths.length > 0 };
}
