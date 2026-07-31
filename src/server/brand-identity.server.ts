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
  // Wordmark next to a logo-ish element.
  for (const f of files) {
    if (!/\.(tsx|jsx)$/.test(f.path)) continue;
    const m = /font-(?:display|bold|semibold|black)[^>]*>\s*([A-Z][A-Za-z0-9&'’.\s]{1,28})\s*</.exec(
      f.content,
    );
    if (m) return m[1].trim();
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

function faviconDataUri(initials: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6ea8"/><stop offset="100%" stop-color="#ffb86c"/></linearGradient></defs><rect width="48" height="48" rx="13" fill="url(#g)"/><text x="24" y="32" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="22" font-weight="700" fill="#ffffff">${initials}</text></svg>`;
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

function ensureFavicon(html: string, initials: string, brand: string): string {
  let out = html;
  const href = faviconDataUri(initials);
  const hasRealIcon =
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.test(out) &&
    !/vite\.svg|favicon\.ico/i.test(out);
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
      `    <meta name="theme-color" content="#0f0f12" />\n  </head>`,
    );
  }
  if (/<title>\s*(vite|react|app|document)?[^<]{0,12}<\/title>/i.test(out)) {
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${brand}</title>`);
  }
  return out;
}

export function ensureBrandIdentity(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const notes: string[] = [];
  // Only web app graphs (index.html present) get this treatment.
  const html = files.find((f) => f.path === "index.html");
  if (!html) return { files, notes };

  const brand = detectBrandName(files);
  const initials = initialsFrom(brand);

  let next = [...files];

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

  // 3. Favicon + theme color.
  next = next.map((f) => {
    if (f.path !== "index.html") return f;
    const content = ensureFavicon(f.content, initials, brand);
    if (content !== f.content) notes.push("brand-identity: injected favicon + apple-touch-icon");
    return { ...f, content };
  });

  return { files: next, notes };
}
