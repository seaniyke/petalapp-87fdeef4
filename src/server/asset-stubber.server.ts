/**
 * Phase 8 — Asset stubber.
 *
 * Failure modes this fixes:
 *   1. `<img src="/hero.jpg">` with no `public/hero.jpg` → broken-image icon.
 *   2. `import hero from "@/assets/hero.png"` with no file at that path →
 *      hard build failure (Rollup "Could not resolve").
 *   3. CSS `background-image: url("/photo.jpg")` with no file → silent
 *      no-render.
 *   4. External `<img src="https://images.unsplash.com/…">` that 403s →
 *      broken-image icon at runtime.
 *
 * Strategy (deterministic, no I/O):
 *   - For local refs that don't exist, generate a procedural SVG placeholder
 *     (gradient block, brand-tinted) at the resolved path. Sized 1200×800;
 *     <img>/CSS will scale via width/height attributes or CSS.
 *   - For external refs in JSX `<img>` / `<Image>` elements, inject an
 *     `onError` handler that swaps to an inline data-URI gradient. Skip when
 *     the element already has `onError`.
 *
 * Pure ProjectFile[] → ProjectFile[].
 */

import type { ProjectFile } from "./generate.server";

const SCANNABLE = /\.(tsx|jsx)$/;
const CSS_SCANNABLE = /\.(css|scss)$/;

// Inline data URI: tiny gradient, used as runtime onError fallback.
const INLINE_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 10"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%23e5e7eb"/><stop offset="1" stop-color="%239ca3af"/></linearGradient></defs><rect width="16" height="10" fill="url(%23g)"/></svg>`,
  );

function makePlaceholderSvg(label: string): string {
  // brand-neutral gradient + tiny label corner — readable in dev, invisible-ish in prod.
  const safe = label.replace(/[<>&"]/g, " ").slice(0, 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f3f4f6"/>
      <stop offset="0.5" stop-color="#e5e7eb"/>
      <stop offset="1" stop-color="#d1d5db"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <g fill="#9ca3af" font-family="system-ui, -apple-system, sans-serif" font-size="28" text-anchor="middle">
    <text x="600" y="408">${safe}</text>
  </g>
</svg>`;
}

const IMG_SRC_RE = /<(?:img|Image)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\/?>/g;
const IMG_TAG_RE = /<(?:img|Image)\b[^>]*\/?>/g;
const ASSET_IMPORT_RE = /from\s+["'](@\/assets\/[^"']+)["']/g;
const ASSET_IMPORT_DEFAULT_RE = /import\s+[^"';]*\s+from\s+["'](@\/assets\/[^"']+)["']/g;
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

function isExternal(ref: string): boolean {
  return /^(https?:)?\/\//.test(ref) || ref.startsWith("data:");
}

function normalizeLocal(ref: string, fromPath: string): string | null {
  // `@/assets/x` → `src/assets/x`
  if (ref.startsWith("@/")) return `src/${ref.slice(2)}`;
  // `/foo.png` → `public/foo.png`
  if (ref.startsWith("/")) return `public${ref}`;
  // `./foo.png` → relative to fromPath
  if (ref.startsWith(".")) {
    const dir = fromPath.split("/").slice(0, -1).join("/");
    const parts = (dir + "/" + ref).split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (!p || p === ".") continue;
      if (p === "..") out.pop();
      else out.push(p);
    }
    return out.join("/");
  }
  return null;
}

function isImageRef(ref: string): boolean {
  return /\.(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i.test(ref);
}

export interface AssetStubResult {
  files: ProjectFile[];
  notes: string[];
  stubsCreated: string[];
  onErrorInjected: number;
}

export function stubMissingAssets(input: ProjectFile[]): AssetStubResult {
  const existing = new Set(input.map((f) => f.path));
  const stubsCreated: string[] = [];
  const toCreate = new Map<string, string>(); // path → content
  let onErrorInjected = 0;
  const notes: string[] = [];

  const needStub = (resolved: string, label: string) => {
    if (existing.has(resolved) || toCreate.has(resolved)) return;
    // Force .svg extension for the stub regardless of original extension.
    // Rollup/Vite serve `.svg?url` and `<img src="/foo.png">` both fine when
    // the underlying file IS an svg renamed — but to avoid MIME issues we
    // write at the EXACT requested path with SVG content. Browsers sniff.
    toCreate.set(resolved, makePlaceholderSvg(label));
    stubsCreated.push(resolved);
  };

  const out: ProjectFile[] = input.map((f) => {
    if (SCANNABLE.test(f.path)) {
      let content = f.content;
      let changed = false;

      // 1. `<img src="…">` / `<Image src="…">`
      let m: RegExpExecArray | null;
      const re = new RegExp(IMG_SRC_RE.source, "g");
      while ((m = re.exec(f.content))) {
        const ref = m[1];
        if (isExternal(ref)) continue;
        // Skip JS expressions / imported identifiers (only literals captured).
        if (!isImageRef(ref)) continue;
        const resolved = normalizeLocal(ref, f.path);
        if (resolved) needStub(resolved, ref.split("/").pop() || "image");
      }

      // 2. `import x from "@/assets/…"`
      const re2 = new RegExp(ASSET_IMPORT_RE.source, "g");
      while ((m = re2.exec(f.content))) {
        const ref = m[1];
        const resolved = normalizeLocal(ref, f.path);
        if (resolved && !existing.has(resolved)) {
          needStub(resolved, ref.split("/").pop() || "asset");
        }
      }

      // 3. inject onError fallback on <img> tags that reference external URLs
      //    and don't already have onError.
      const reTag = new RegExp(IMG_TAG_RE.source, "g");
      const rebuilt: { start: number; end: number; tag: string }[] = [];
      while ((m = reTag.exec(f.content))) {
        const tag = m[0];
        if (/\bonError\s*=/.test(tag)) continue;
        const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/.exec(tag);
        if (!srcMatch) continue;
        if (!isExternal(srcMatch[1])) continue;
        // Insert onError before the closing `/>` or `>`.
        const closeMatch = /\/?>$/.exec(tag);
        if (!closeMatch) continue;
        const closeIdx = closeMatch.index;
        const inject = ` onError={(e) => { const t = e.currentTarget as HTMLImageElement; if (t.dataset.fallback) return; t.dataset.fallback = "1"; t.src = "${INLINE_FALLBACK}"; }}`;
        const newTag = tag.slice(0, closeIdx) + inject + tag.slice(closeIdx);
        rebuilt.push({ start: m.index, end: m.index + tag.length, tag: newTag });
      }
      if (rebuilt.length) {
        // Apply rewrites in reverse to keep offsets valid.
        for (let i = rebuilt.length - 1; i >= 0; i--) {
          const r = rebuilt[i];
          content = content.slice(0, r.start) + r.tag + content.slice(r.end);
        }
        onErrorInjected += rebuilt.length;
        changed = true;
      }

      if (changed) return { path: f.path, content };
      return f;
    }

    if (CSS_SCANNABLE.test(f.path)) {
      let m: RegExpExecArray | null;
      const re = new RegExp(CSS_URL_RE.source, "g");
      while ((m = re.exec(f.content))) {
        const ref = m[1];
        if (isExternal(ref)) continue;
        if (!isImageRef(ref)) continue;
        const resolved = normalizeLocal(ref, f.path);
        if (resolved) needStub(resolved, ref.split("/").pop() || "image");
      }
    }
    return f;
  });

  // Append newly created stub files.
  for (const [path, content] of toCreate) {
    out.push({ path, content });
  }

  if (stubsCreated.length) {
    notes.push(
      `asset-stubber: created ${stubsCreated.length} placeholder file(s) (${stubsCreated.slice(0, 3).join(", ")}${stubsCreated.length > 3 ? "…" : ""})`,
    );
  }
  if (onErrorInjected) {
    notes.push(`asset-stubber: injected onError fallback on ${onErrorInjected} external <img>`);
  }

  return { files: out, notes, stubsCreated, onErrorInjected };
}
