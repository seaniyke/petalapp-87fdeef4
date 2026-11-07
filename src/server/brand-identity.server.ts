/**
 * Brand identity guarantee.
 *
 * Root cause this addresses: generated apps shipped with NO logo — the model
 * reaches for a generic lucide glyph (`<Square/>`, `<Box/>`, `<Circle/>`)
 * next to the wordmark, and index.html keeps the framework's default favicon
 * (or none at all). The result reads as a placeholder, not a product.
 *
 * This pass makes brand identity structural instead of hopeful:
 *   1. Writes `src/components/brand-mark.tsx` — a real, themed SVG mark
 *      (rounded gradient tile + petal glyph + monogram) driven by design
 *      tokens, so it works in light and dark themes.
 *   2. Swaps placeholder lucide glyphs used AS the logo for <BrandMark/>.
 *   3. Injects a matching inline-SVG favicon + apple-touch-icon + theme-color
 *      into index.html when the project has none (or still points at the
 *      framework default).
 *
 * Pure: ProjectFile[] → ProjectFile[].
 */

import type { ProjectFile } from "./generate.server";

const BRAND_MARK_PATH = "src/components/brand-mark.tsx";

/** Lucide glyphs that mean "I had no logo idea". */
const PLACEHOLDER_ICONS = [
  "Square",
  "Box",
  "Circle",
  "Squircle",
  "Hexagon",
  "Triangle",
  "Shapes",
  "Component",
  "Sparkle",
  "Sparkles",
];

function initialsFrom(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9\s&-]/g, " ")
    .split(/[\s&-]+/)
    .filter((w) => w && !/^(the|and|app|inc|co|ltd|studio)$/i.test(w));
  if (words.length === 0) return "A";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Best-effort brand name from the project's own files. */
function detectBrandName(files: ProjectFile[]): string {
  const html = files.find((f) => f.path === "index.html")?.content ?? "";
  const title = /<title>([^<]{2,60})<\/title>/i.exec(html)?.[1]?.trim();
  if (title && !/^(vite|react|app|document)\b/i.test(title)) {
    return title.split(/[–—|·-]/)[0].trim();
  }
  // Wordmark next to a logo-ish element — only in the project's own
  // header/layout files, never in starter-kit examples (whose sample copy,
  // e.g. "Weekly report", was being stamped into the tab title).
  const own = files.filter(
    (f) =>
      /\.(tsx|jsx)$/.test(f.path) &&
      !/^src\/components\/(blocks|examples|ui|motion|fx|content|mobile)\//.test(f.path),
  );
  const ranked = [
    ...own.filter((f) => /layout|header|nav|brand|logo/i.test(f.path)),
    ...own.filter((f) => !/layout|header|nav|brand|logo/i.test(f.path)),
  ];
  for (const f of ranked) {
    const m = /font-(?:display|serif|bold|semibold|black)[^>]*>\s*([A-Z][A-Za-z0-9&'’.\s]{1,28})\s*</.exec(
      f.content,
    );
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ");
      return /^[A-Z0-9&'’.\s]+$/.test(name) && name.length > 1
        ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
        : name;
    }
  }
  return "Studio";
}

function brandMarkSource(initials: string): string {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The product's logo mark. A single source of truth so the header, footer,
 * auth screens and empty states never drift. Colors come from theme tokens,
 * so the mark works in light and dark mode.
 */
export function BrandMark({
  className,
  initials = "${initials}",
}: {
  className?: string;
  initials?: string;
}) {
  const id = React.useId();
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Logo"
      className={cn("h-8 w-8 shrink-0", className)}
    >
      <defs>
        <linearGradient id={\`bm-\${id}\`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={\`url(#bm-\${id})\`} className="text-primary" />
      <path
        d="M24 10c6.2 3.1 9.5 7.6 9.5 12.6 0 5.3-4.2 9.4-9.5 9.4s-9.5-4.1-9.5-9.4C14.5 17.6 17.8 13.1 24 10Z"
        fill="currentColor"
        opacity="0.16"
      />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="hsl(var(--primary-foreground, 0 0% 100%))"
        style={{ fontFamily: "inherit" }}
      >
        {initials}
      </text>
    </svg>
  );
}

export default BrandMark;
`;
}

/** Read the app's own primary colour out of its theme CSS. */
export function resolvePrimaryHex(files: ProjectFile[]): string | null {
  const css = files.find((f) => /^src\/(index|styles|globals?)\.css$/.test(f.path));
  if (!css) return null;
  const hex = /--primary:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css.content);
  if (hex) return hex[1];
  const hsl = /--primary:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(css.content);
  if (!hsl) return null;
  return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (n: number) =>
    Math.round(255 * f(n))
      .toString(16)
      .padStart(2, "0");
  return `#${to(0)}${to(8)}${to(4)}`;
}

/** Relative luminance → pick readable text on the tile. */
function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111318" : "#ffffff";
}

/**
 * Extract the generated mark's own artwork so the tab icon matches the logo
 * in the app. Only inlined when the SVG body is plain markup (no JSX
 * expressions, no component references) — otherwise we fall back to the
 * monogram tile.
 */
export function markGlyphFrom(files: ProjectFile[]): { body: string; viewBox: string } | null {
  const mark = files.find((f) => f.path === BRAND_MARK_PATH);
  if (!mark) return null;
  const vb = /viewBox="([^"]+)"/.exec(mark.content);
  const open = /<svg\b[^>]*>/.exec(mark.content);
  const close = mark.content.lastIndexOf("</svg>");
  if (!vb || !open || close < 0) return null;
  let body = mark.content.slice(open.index + open[0].length, close);
  body = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim();
  if (!body || /[{}]/.test(body) || /<[A-Z]/.test(body)) return null;
  // JSX attribute names → SVG attribute names.
  body = body
    .replace(/\b([a-z]+)([A-Z][a-zA-Z]*)=/g, (_m, a: string, b: string) => `${a}-${b.toLowerCase()}=`)
    .replace(/\sclassName="[^"]*"/g, "")
    .replace(/\s+/g, " ");
  if (body.length > 1200) return null;
  return { body, viewBox: vb[1] };
}

function faviconDataUri(
  initials: string,
  primary: string,
  glyph: { body: string; viewBox: string } | null,
): string {
  const fg = readableOn(primary);
  const svg = glyph
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${glyph.viewBox}" fill="none" color="${primary}">${glyph.body.replace(/currentColor/g, primary)}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="${primary}"/><text x="24" y="32" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="22" font-weight="700" fill="${fg}">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}


/** Which files may legitimately host the logo. */
function isBrandSurface(path: string): boolean {
  return /(^|\/)(App\.tsx|main\.tsx)$|nav|header|footer|shell|layout|sidebar|topbar|brand|logo|__root/i.test(
    path,
  );
}

function swapPlaceholderLogo(
  content: string,
): { content: string; swapped: string[] } {
  let out = content;
  const swapped: string[] = [];

  for (const icon of PLACEHOLDER_ICONS) {
    // The glyph is a logo when it sits immediately before a wordmark span.
    const re = new RegExp(
      `<${icon}\\b([^>]*?)/>(\\s*)(<span\\b[^>]*font-)`,
      "g",
    );
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, (_m, attrs: string, gap: string, tail: string) => {
      const cls = /className=("[^"]*"|\{[^}]*\})/.exec(attrs)?.[1];
      const sized = cls ? ` className=${cls}` : ' className="h-8 w-8"';
      return `<BrandMark${sized} />${gap}${tail}`;
    });
    swapped.push(icon);
  }

  if (swapped.length === 0) return { content, swapped };

  // Drop now-unused lucide specifiers.
  out = out.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["'];?/g,
    (full, names: string) => {
      const kept = names
        .split(",")
        .map((n: string) => n.trim())
        .filter(Boolean)
        .filter((n: string) => {
          const local = n.split(/\s+as\s+/).pop()!.trim();
          if (!swapped.includes(local)) return true;
          // Keep it if still referenced elsewhere in the file.
          return new RegExp(`<${local}\\b`).test(out);
        });
      if (kept.length === 0) return "";
      if (kept.length === names.split(",").filter((s: string) => s.trim()).length) return full;
      return `import { ${kept.join(", ")} } from "lucide-react";`;
    },
  );

  if (!/from\s+["']@\/components\/brand-mark["']/.test(out)) {
    const firstImport = /^import .*$/m.exec(out);
    const line = `import { BrandMark } from "@/components/brand-mark";`;
    out = firstImport
      ? out.slice(0, firstImport.index) + line + "\n" + out.slice(firstImport.index)
      : line + "\n" + out;
  }

  return { content: out, swapped };
}

function ensureFavicon(
  html: string,
  initials: string,
  brand: string,
  primary: string,
  glyph: { body: string; viewBox: string } | null,
): string {
  let out = html;
  const href = faviconDataUri(initials, primary, glyph);
  // The old build shipped a fixed pink→orange tile for every app; treat it as
  // a placeholder so existing projects pick up their own colours on rebuild.
  const legacyTile = /ff6ea8|%23ff6ea8/i.test(out);
  const hasRealIcon =
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.test(out) &&
    !/vite\.svg|favicon\.ico/i.test(out) &&
    !legacyTile;
  if (!hasRealIcon) {
    out = out.replace(
      /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>\s*/gi,
      "",
    );
    const tags = [
      `    <link rel="icon" type="image/svg+xml" href="${href}" />`,
      `    <link rel="apple-touch-icon" href="${href}" />`,
    ].join("\n");
    out = out.replace(/<\/head>/i, `${tags}\n  </head>`);
  }
  if (!/name=["']theme-color["']/i.test(out)) {
    out = out.replace(
      /<\/head>/i,
      `    <meta name="theme-color" content="${primary}" />\n  </head>`,
    );
  }

  // Only a generic placeholder title is replaced; a real short name
  // ("Aura") is never overwritten.
  if (/<title>\s*(vite(\s*\+\s*react(\s*\+\s*ts)?)?|react app|app|document|untitled)?\s*<\/title>/i.test(out) && brand !== "Studio") {
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${brand}</title>`);
  }
  return out;
}

/**
 * Guarantee that every `<BrandMark/>` usage resolves at runtime.
 *
 * Root cause of `Can't find variable: BrandMark`: the brand contract prompt
 * tells the model to render `<BrandMark/>`, and the model happily does — in a
 * header/footer — without importing it, or without ever authoring
 * `src/components/brand-mark.tsx`. TypeScript-loose JSX treats the unknown
 * PascalCase tag as `any`, so the build passes and the preview white-screens.
 *
 * This pass is deterministic and idempotent:
 *   - creates `src/components/brand-mark.tsx` when anything references it,
 *   - repairs a stub that lost the named export,
 *   - injects the import into every file that uses the tag undeclared.
 *
 * Runs BEFORE the local import resolver so the resolver never stubs the file.
 */
export function ensureBrandMarkWired(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const notes: string[] = [];
  const MODULE = "@/components/brand-mark";

  const usesTag = (src: string) => /<BrandMark[\s/>]/.test(stripNoise(src));
  const referenced = files.some(
    (f) =>
      /\.(tsx|jsx)$/.test(f.path) &&
      f.path !== BRAND_MARK_PATH &&
      (usesTag(f.content) || f.content.includes(MODULE)),
  );
  if (!referenced) return { files, notes };

  const brand = detectBrandName(files);
  const initials = initialsFrom(brand);

  let next = [...files];
  const existing = next.find((f) => f.path === BRAND_MARK_PATH);
  if (!existing) {
    next.push({ path: BRAND_MARK_PATH, content: brandMarkSource(initials) });
    notes.push(`brand-identity: created ${BRAND_MARK_PATH} (monogram "${initials}")`);
  } else if (!/export\s+(?:function|const)\s+BrandMark\b/.test(existing.content)) {
    // A stub (or a default-only module) can't satisfy `{ BrandMark }`.
    next = next.map((f) =>
      f.path === BRAND_MARK_PATH ? { ...f, content: brandMarkSource(initials) } : f,
    );
    notes.push(`brand-identity: repaired ${BRAND_MARK_PATH} (missing named export)`);
  }

  let wired = 0;
  next = next.map((f) => {
    if (!/\.(tsx|jsx)$/.test(f.path) || f.path === BRAND_MARK_PATH) return f;
    if (!usesTag(f.content)) return f;
    if (isBrandMarkDeclared(f.content)) return f;
    wired++;
    return { ...f, content: injectBrandMarkImport(f.content) };
  });
  if (wired > 0) notes.push(`brand-identity: wired <BrandMark/> import into ${wired} file(s)`);

  return { files: next, notes };
}

/** Strip comments and string/template literals so tag scans aren't poisoned. */
function stripNoise(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/`(?:\\[\s\S]|\$\{[\s\S]*?\}|[^`\\])*`/g, " ")
    .replace(/"(?:\\[\s\S]|[^"\\])*"/g, " ")
    .replace(/'(?:\\[\s\S]|[^'\\])*'/g, " ");
}

/** Is `BrandMark` imported or locally declared in this module? */
function isBrandMarkDeclared(src: string): boolean {
  const clean = stripNoise(src);
  if (/(?:const|let|var|function|class)\s+BrandMark\b/.test(clean)) return true;
  const importRe = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?[^;\n]*from/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(clean))) {
    if (m[1] === "BrandMark") return true;
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const local = part.trim().replace(/^type\s+/i, "").split(/\s+as\s+/i).pop()?.trim();
        if (local === "BrandMark") return true;
      }
    }
  }
  return false;
}

/** Insert the BrandMark import after the last top-level import (or at top). */
function injectBrandMarkImport(src: string): string {
  const line = `import { BrandMark } from "@/components/brand-mark";\n`;
  const importRe = /^import[^\n]*\n/gm;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) lastEnd = m.index + m[0].length;
  if (lastEnd === 0) return line + src;
  return src.slice(0, lastEnd) + line + src.slice(lastEnd);
}

function injectNamedImport(src: string, name: string, module: string): string {
  if (new RegExp(`from\\s+["']${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(src)) {
    return src;
  }
  const line = `import { ${name} } from "${module}";\n`;
  const importRe = /^import[^\n]*\n/gm;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(src))) lastEnd = match.index + match[0].length;
  return src.slice(0, lastEnd) + line + src.slice(lastEnd);
}

/**
 * A logo component existing somewhere in the graph does not mean the user can
 * see it. Generated landing pages commonly render a bare `<NavBar />`, while
 * the actual Logo component is only used inside the signed-in shell. Wire the
 * canonical lockup into those empty navigation calls deterministically.
 */
function ensureVisibleLogoPlacement(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const logoFile = files.find(
    (file) => file.path === "src/components/Logo.tsx" && /export\s+(?:function|const)\s+Logo\b/.test(file.content),
  );
  const name = logoFile ? "Logo" : "BrandMark";
  const module = logoFile ? "@/components/Logo" : "@/components/brand-mark";
  let wired = 0;

  const next = files.map((file) => {
    if (!/\.(tsx|jsx)$/.test(file.path) || file.path.startsWith("src/components/blocks/")) return file;
    if (!/<NavBar\s*\/>/.test(file.content)) return file;
    let content = file.content.replace(/<NavBar\s*\/>/g, `<NavBar brand={<${name} />} />`);
    content = injectNamedImport(content, name, module);
    wired++;
    return { ...file, content };
  });

  return {
    files: next,
    notes: wired > 0 ? [`brand-identity: placed the logo in ${wired} empty navigation surface(s)`] : [],
  };
}

export function ensureBrandIdentity(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const notes: string[] = [];
  // Wiring first: it must happen even for graphs with no index.html
  // (Expo/extension targets), and before any placeholder swap.
  const wiredPass = ensureBrandMarkWired(files);
  let next = wiredPass.files;
  notes.push(...wiredPass.notes);

  // Only web app graphs (index.html present) get the rest of the treatment.
  const html = next.find((f) => f.path === "index.html");
  if (!html) return { files: next, notes };

  const brand = detectBrandName(next);
  const initials = initialsFrom(brand);

  // 1. Guarantee the mark component exists.
  if (!next.some((f) => f.path === BRAND_MARK_PATH)) {
    next.push({ path: BRAND_MARK_PATH, content: brandMarkSource(initials) });
    notes.push(`brand-identity: created ${BRAND_MARK_PATH} (monogram "${initials}")`);
  }


  // 2. Swap placeholder glyphs used as the logo.
  let swaps = 0;
  next = next.map((f) => {
    if (!/\.(tsx|jsx)$/.test(f.path) || !isBrandSurface(f.path)) return f;
    if (f.path === BRAND_MARK_PATH) return f;
    const { content, swapped } = swapPlaceholderLogo(f.content);
    if (swapped.length === 0) return f;
    swaps += swapped.length;
    return { ...f, content };
  });
  if (swaps > 0) notes.push(`brand-identity: replaced ${swaps} placeholder logo glyph(s) with <BrandMark/>`);

  // 3. A real mark must be visible, not merely present as an unused file.
  const placementPass = ensureVisibleLogoPlacement(next);
  next = placementPass.files;
  notes.push(...placementPass.notes);

  // 4. Favicon + theme color — built from the app's own mark and palette.
  const primary = resolvePrimaryHex(next) ?? "#111318";
  const glyph = markGlyphFrom(next);
  next = next.map((f) => {
    if (f.path !== "index.html") return f;
    const content = ensureFavicon(f.content, initials, brand, primary, glyph);
    if (content !== f.content) notes.push("brand-identity: injected favicon + apple-touch-icon");
    return { ...f, content };
  });


  return { files: next, notes };
}
