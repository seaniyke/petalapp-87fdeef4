import type { ProjectFile } from "@/server/generate.server";

/**
 * Build a single self-contained HTML document for the iframe preview by
 * inlining sibling CSS and JS files referenced by index.html. This lets the
 * preview run from a srcDoc without needing a real filesystem.
 */
export function buildPreviewDoc(files: ProjectFile[]): string {
  const map = new Map(files.map((f) => [f.path.replace(/^\.?\//, ""), f.content]));
  const indexHtml = map.get("index.html");
  if (!indexHtml) {
    return `<!doctype html><html><body style="font-family:system-ui;padding:40px;color:#666">No <code>index.html</code> in project yet.</body></html>`;
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
