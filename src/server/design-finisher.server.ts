/**
 * Design finisher — make the locked design direction REAL.
 *
 * The design director picks a palette, a font pair and a motion level, and
 * the prompt tells the model to wire them up. In practice the model declares
 * `--font-display: "Syne"` in `src/styles.css` and then never loads the font,
 * so the browser silently falls back to system sans and the app reads as
 * "plain". Same story for motion and depth: instructed, rarely shipped.
 *
 * This pass does not ask for taste — it applies it deterministically:
 *
 *   1. FONT LOADING   — ensure the declared display/body families are actually
 *                       loaded (Google Fonts <link> in index.html head, or the
 *                       TanStack root route head when there is no index.html).
 *   2. TYPE FLOOR     — body uses --font-body, h1..h3 use --font-display, and
 *                       the `font-display` / `font-body` utilities exist.
 *   3. DEPTH FLOOR    — --gradient-primary / --shadow-elegant tokens exist so
 *                       sections have something better than flat white.
 *   4. MOTION FLOOR   — a `fade-in-up` keyframe + utility exists and the hero
 *                       headline uses it when the page ships zero animation.
 *
 * Pure ProjectFile[] → ProjectFile[]; every step is idempotent and skipped
 * when the app already did the right thing. Runs inside `runAllRepairs`.
 */

import type { ProjectFile } from "./generate.server";

export interface DesignFinishResult {
  files: ProjectFile[];
  notes: string[];
  fixes: number;
}

const STYLE_PATHS = ["src/styles.css", "src/index.css", "src/app.css"];

/** Conservative default pair when the app declared no type system at all. */
const DEFAULT_PAIR = { display: "Sora", body: "Manrope" };

/** Families that don't need loading (system stacks). */
const SYSTEM_FAMILIES =
  /^(ui-sans-serif|system-ui|-apple-system|sans-serif|serif|monospace|ui-serif|ui-monospace|inherit|initial)$/i;

function findStyles(files: ProjectFile[]): ProjectFile | undefined {
  for (const p of STYLE_PATHS) {
    const f = files.find((x) => x.path === p);
    if (f) return f;
  }
  return files.find((x) => /^src\/.*\.css$/.test(x.path));
}

/** First quoted family name of a `--font-x: "Foo", ...;` declaration. */
function readFamily(css: string, token: string): string | null {
  const rx = new RegExp(`--${token}\\s*:\\s*([^;]+);`);
  const m = rx.exec(css);
  if (!m) return null;
  const first = (m[1] ?? "").split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (!first || SYSTEM_FAMILIES.test(first)) return null;
  return first;
}

function googleFamilyParam(name: string, weights: string): string {
  return `family=${name.trim().replace(/\s+/g, "+")}:wght@${weights}`;
}

export function buildFontHref(display: string, body: string): string {
  const parts = [googleFamilyParam(display, "400;500;600;700;800")];
  if (body.toLowerCase() !== display.toLowerCase()) {
    parts.push(googleFamilyParam(body, "400;500;600;700"));
  }
  return `https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap`;
}

function alreadyLoads(content: string, display: string, body: string): boolean {
  if (!/fonts\.googleapis\.com|@fontsource/i.test(content)) return false;
  const norm = content.replace(/\+/g, " ").toLowerCase();
  return norm.includes(display.toLowerCase()) && norm.includes(body.toLowerCase());
}

// ---------------------------------------------------------------------------
// 1 + 2. Fonts
// ---------------------------------------------------------------------------

function ensureFontTokens(css: string, display: string, body: string): { css: string; changed: boolean } {
  let out = css;
  let changed = false;

  const hasDisplay = /--font-display\s*:/.test(out);
  const hasBody = /--font-body\s*:/.test(out);
  if (!hasDisplay || !hasBody) {
    const decl =
      `${hasDisplay ? "" : `  --font-display: "${display}", ui-sans-serif, system-ui, sans-serif;\n`}` +
      `${hasBody ? "" : `  --font-body: "${body}", ui-sans-serif, system-ui, sans-serif;\n`}`;
    const themeOpen = /@theme[^{]*\{\n?/.exec(out);
    if (themeOpen) {
      const at = themeOpen.index + themeOpen[0].length;
      out = out.slice(0, at) + decl + out.slice(at);
    } else {
      out += `\n@theme {\n${decl}}\n`;
    }
    changed = true;
  }

  // Base typography floor — outside @theme so it emits real CSS.
  if (!/petal:type-floor/.test(out)) {
    out += `
/* petal:type-floor — the locked type pair must be visible, not just declared */
body {
  font-family: var(--font-body);
}
h1, h2, h3, .font-display {
  font-family: var(--font-display);
  letter-spacing: -0.02em;
}
`;
    changed = true;
  }

  return { css: out, changed };
}

function injectLinkIntoHtml(html: string, href: string): string | null {
  if (!/<head[^>]*>/i.test(html)) return null;
  const tags =
    `\n    <link rel="preconnect" href="https://fonts.googleapis.com" />` +
    `\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />` +
    `\n    <link rel="stylesheet" href="${href}" />`;
  return html.replace(/<head[^>]*>/i, (m) => m + tags);
}

/** TanStack root route: append link descriptors to head().links. */
function injectLinkIntoRootRoute(src: string, href: string): string | null {
  const linksRx = /links:\s*\[/;
  const entries =
    `\n      { rel: "preconnect", href: "https://fonts.googleapis.com" },` +
    `\n      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },` +
    `\n      { rel: "stylesheet", href: "${href}" },`;
  if (linksRx.test(src)) return src.replace(linksRx, (m) => m + entries);
  const headRx = /head:\s*\(\s*\)\s*=>\s*\(\{/;
  if (headRx.test(src)) return src.replace(headRx, (m) => `${m}\n    links: [${entries}\n    ],`);
  return null;
}

// ---------------------------------------------------------------------------
// 3. Depth tokens
// ---------------------------------------------------------------------------

function ensureDepthTokens(css: string): { css: string; changed: boolean } {
  if (/petal:depth-floor/.test(css)) return { css, changed: false };
  const needsGradient = !/--gradient-primary\s*:/.test(css);
  const needsShadow = !/--shadow-elegant\s*:/.test(css);
  if (!needsGradient && !needsShadow) return { css, changed: false };

  return {
    css:
      css +
      `
/* petal:depth-floor — layered surfaces instead of flat white bands */
:root {
${needsGradient ? "  --gradient-primary: linear-gradient(135deg, var(--primary), var(--primary-glow, var(--primary)));\n" : ""}${
        needsShadow
          ? "  --shadow-elegant: 0 18px 40px -18px color-mix(in oklab, var(--primary) 35%, transparent);\n"
          : ""
      }}
`,
    changed: true,
  };
}

// ---------------------------------------------------------------------------
// 4. Motion floor
// ---------------------------------------------------------------------------

const MOTION_CSS = `
/* petal:motion-floor — one honest entrance animation, respects reduced motion */
@keyframes petal-fade-in-up {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}
.animate-fade-in-up {
  animation: petal-fade-in-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  .animate-fade-in-up { animation: none; }
}
`;

function hasAnyMotion(files: ProjectFile[]): boolean {
  return files.some(
    (f) =>
      /^src\/(pages|routes|components|sections)\//.test(f.path) &&
      /\.(tsx|jsx)$/.test(f.path) &&
      /(framer-motion|\bmotion\.|animate-(fade|scale|slide|in|enter)|data-reveal|useInView)/.test(f.content),
  );
}

/** Add the entrance class to the first h1 that has a string className. */
function animateHeroHeadline(content: string): { content: string; changed: boolean } {
  const rx = /<h1([^>]*?)className=("([^"]*)"|'([^']*)')/;
  const m = rx.exec(content);
  if (!m) return { content, changed: false };
  const cls = m[3] ?? m[4] ?? "";
  if (/animate-/.test(cls)) return { content, changed: false };
  const quote = m[3] !== undefined ? '"' : "'";
  const replaced = `<h1${m[1]}className=${quote}${cls} animate-fade-in-up${quote}`;
  return { content: content.slice(0, m.index) + replaced + content.slice(m.index + m[0].length), changed: true };
}

// ---------------------------------------------------------------------------

export function enforceDesignFinish(input: ProjectFile[]): DesignFinishResult {
  const notes: string[] = [];
  let fixes = 0;
  let files = input;

  const styles = findStyles(files);
  if (!styles) return { files, notes, fixes };

  const display = readFamily(styles.content, "font-display") ?? DEFAULT_PAIR.display;
  const body = readFamily(styles.content, "font-body") ?? DEFAULT_PAIR.body;

  // 1 + 2 — tokens and base typography.
  let css = styles.content;
  const tokens = ensureFontTokens(css, display, body);
  css = tokens.css;
  if (tokens.changed) {
    fixes++;
    notes.push(`design-finisher: applied the locked type pair (${display} / ${body}) to body and headings`);
  }

  const depth = ensureDepthTokens(css);
  css = depth.css;
  if (depth.changed) {
    fixes++;
    notes.push("design-finisher: added gradient/elevation tokens so sections aren't flat");
  }

  // 4 — motion floor CSS (added regardless so the utility resolves).
  const needsMotion = !hasAnyMotion(files);
  if (needsMotion && !/petal:motion-floor/.test(css)) {
    css += MOTION_CSS;
    fixes++;
  }

  if (css !== styles.content) {
    files = files.map((f) => (f.path === styles.path ? { ...f, content: css } : f));
  }

  // 1 — actually LOAD the fonts.
  const href = buildFontHref(display, body);
  const loadedSomewhere = files.some((f) => alreadyLoads(f.content, display, body));
  if (!loadedSomewhere) {
    const html = files.find((f) => f.path === "index.html" || f.path.endsWith("/index.html"));
    const rootRoute = files.find((f) => f.path === "src/routes/__root.tsx");
    let injected = false;

    if (html) {
      const next = injectLinkIntoHtml(html.content, href);
      if (next) {
        files = files.map((f) => (f.path === html.path ? { ...f, content: next } : f));
        injected = true;
      }
    }
    if (!injected && rootRoute) {
      const next = injectLinkIntoRootRoute(rootRoute.content, href);
      if (next) {
        files = files.map((f) => (f.path === rootRoute.path ? { ...f, content: next } : f));
        injected = true;
      }
    }
    if (injected) {
      fixes++;
      notes.push(`design-finisher: loaded ${display} + ${body} from Google Fonts (they were declared but never loaded)`);
    }
  }

  // 4 — hero entrance when the app shipped no animation at all.
  if (needsMotion) {
    const heroCandidates = files.filter(
      (f) =>
        /\.(tsx|jsx)$/.test(f.path) &&
        /^src\/(pages|routes|components|sections)\//.test(f.path) &&
        /<h1[\s>]/.test(f.content),
    );
    const target =
      heroCandidates.find((f) => /hero/i.test(f.path)) ??
      heroCandidates.find((f) => /(home|index|landing)/i.test(f.path)) ??
      heroCandidates[0];
    if (target) {
      const out = animateHeroHeadline(target.content);
      if (out.changed) {
        files = files.map((f) => (f.path === target.path ? { ...f, content: out.content } : f));
        fixes++;
        notes.push("design-finisher: added a hero entrance animation (the build shipped none)");
      }
    }
  }

  return { files, notes, fixes };
}
