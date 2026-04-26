import type { ProjectFile } from "@/server/generate.server";

/**
 * Build a single self-contained HTML document for the iframe preview.
 *
 * Supports two project shapes:
 * 1. Legacy vanilla web apps with index.html + sibling local CSS/JS files —
 *    we inline them so the iframe can run from a srcDoc.
 * 2. Modern Vite + React + TypeScript projects (the new default) — these need
 *    a real bundler, so we render a friendly "Open in builder to preview"
 *    card with a glance at the project structure.
 */
export function buildPreviewDoc(files: ProjectFile[]): string {
  if (files.length === 0) return staticPlaceholder("This project has no files yet.");

  const map = new Map(files.map((f) => [f.path.replace(/^\.?\//, ""), f.content]));
  const isVite = map.has("package.json") || files.some((f) => f.path.endsWith(".tsx"));
  const indexHtml = map.get("index.html");

  // Vite/React projects: srcDoc can't run them. Show a read-only card.
  if (isVite || !indexHtml) {
    const fileList = files
      .slice(0, 12)
      .map((f) => `<li><code>${escapeHtml(f.path)}</code></li>`)
      .join("");
    const more = files.length > 12 ? `<li class="more">+ ${files.length - 12} more</li>` : "";
    return staticPlaceholder(
      `<div class="card">
        <h1>React + Vite project</h1>
        <p>This app needs a build step. Open it in the builder to run a live preview powered by WebContainers.</p>
        <ul>${fileList}${more}</ul>
      </div>`
    );
  }

  let doc = indexHtml;

  // Inline <link rel="stylesheet" href="local.css">
  doc = doc.replace(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (full, href) => {
      const key = href.replace(/^\.?\//, "");
      const css = map.get(key);
      if (css == null) return full; // leave external CDN links alone
      return `<style data-src="${href}">${css}</style>`;
    }
  );

  // Inline <script src="local.js">
  doc = doc.replace(
    /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (full, pre, src, post) => {
      const key = src.replace(/^\.?\//, "");
      const js = map.get(key);
      if (js == null) return full; // leave CDN scripts alone
      const attrs = `${pre} ${post}`.trim();
      return `<script ${attrs} data-src="${src}">\n${js}\n</script>`;
    }
  );

  return doc;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function staticPlaceholder(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(180deg,#fff,#f7f3ee); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f1b16; padding: 24px; }
    .card { max-width: 420px; padding: 28px; background: #fff; border: 1px solid #ece6db; border-radius: 18px; box-shadow: 0 8px 24px rgba(40,30,15,.06); }
    h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
    p { margin: 0 0 14px; font-size: 13px; line-height: 1.55; color: #6b5f51; }
    ul { margin: 0; padding: 10px 0 0 0; list-style: none; border-top: 1px dashed #ece6db; display: grid; gap: 4px; }
    li { font-size: 12px; color: #6b5f51; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f6f1ea; padding: 1px 6px; border-radius: 5px; }
    .more { color: #a09484; font-style: italic; }
  </style></head><body>${inner}</body></html>`;
}
