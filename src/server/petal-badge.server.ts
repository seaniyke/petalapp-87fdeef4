/**
 * "Powered by Petal" badge injection.
 *
 * Adds a small, non-intrusive floating link to the bottom-right of built apps.
 * We append a <style> + <a> block to index.html so the badge renders on every
 * route of the deployed SPA without touching any generated React code.
 *
 * IMPORTANT: this lives in its own server module (not next to one specific
 * build entry point) so EVERY pathway that ships files to the Railway builder
 * — the normal `/api/builds/trigger` flow, manual rebuild scripts, future
 * autofix retries, anything else — gets the badge automatically. Free-plan
 * projects must show this badge; paid plans may opt out via project settings.
 */
import type { ProjectFile } from "@/server/generate.server";

const PETAL_BADGE_HTML = `
<style id="petal-badge-style">
  #petal-badge {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 2147483646;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px 8px;
    border-radius: 999px;
    background: rgba(17, 17, 17, 0.85);
    color: #fff;
    font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    text-decoration: none;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    backdrop-filter: saturate(140%) blur(6px);
    -webkit-backdrop-filter: saturate(140%) blur(6px);
    transition: transform .15s ease, opacity .15s ease;
    opacity: .9;
  }
  #petal-badge:hover { opacity: 1; transform: translateY(-1px); }
  #petal-badge .petal-dot {
    display: inline-block;
    width: 14px; height: 14px;
    border-radius: 999px;
    background: linear-gradient(135deg, #ff6ea8, #ffb86c);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.12) inset;
  }
  @media (prefers-color-scheme: light) {
    #petal-badge { background: rgba(255,255,255,0.92); color: #111; box-shadow: 0 6px 18px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06) inset; }
  }
  @media print { #petal-badge { display: none !important; } }
</style>
<a id="petal-badge" href="https://buildwithpetal.com?utm_source=petal_badge" target="_blank" rel="noopener noreferrer" aria-label="Powered by Petal">
  <span class="petal-dot" aria-hidden="true"></span>
  <span>Powered by <strong style="font-weight:600">Petal</strong></span>
</a>
`;

export function injectPetalBadge(files: ProjectFile[]): ProjectFile[] {
  return files.map((f) => {
    if (f.path !== "index.html") return f;
    if (f.content.includes('id="petal-badge"')) return f; // idempotent
    const closingBody = /<\/body>/i;
    if (closingBody.test(f.content)) {
      return { ...f, content: f.content.replace(closingBody, `${PETAL_BADGE_HTML}\n</body>`) };
    }
    // Fallback: append to end if no </body> tag (very unusual).
    return { ...f, content: `${f.content}\n${PETAL_BADGE_HTML}\n` };
  });
}
