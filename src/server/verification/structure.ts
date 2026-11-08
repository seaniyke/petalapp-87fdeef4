/**
 * Page-chrome guard. The shared frame (src/App.tsx or the layout it renders)
 * owns the site header, navigation and any announcement strip. A page that
 * renders its own site header with navigation, or its own announcement/promo
 * bar, stacks a second bar on top of the real one — the classic "extra bar
 * above the header" AI mistake.
 *
 * Deterministic and deliberately narrow so valid apps are never rejected:
 *  - only files under src/pages/ are inspected (layouts/shell are exempt);
 *  - in-page navs (tabs, breadcrumbs, pagination, filters, steps) are allowed;
 *  - a page <header> is fine unless it also contains a site <nav>.
 */
import type { ProjectFile } from "@/server/generate.server";

export interface ChromeFinding {
  path: string;
  reason: string;
}

const IN_PAGE_NAV = /aria-label\s*=\s*["'{][^"'}]*(breadcrumb|tab|pagination|page\s*nav|step|filter|section|table of contents|toc|categor)/i;
const ANNOUNCEMENT_CLASS = /className\s*=\s*["'`{][^"'`}]*\b(announcement(-bar)?|promo-?bar|top-?bar|notice-?bar|banner-?strip|marquee-?bar)\b/i;

/** Each <header>…</header> block in the source (non-greedy, unnested). */
function headerBlocks(src: string): string[] {
  return src.match(/<header\b[\s\S]*?<\/header>/gi) ?? [];
}

/** <nav …> opening tags that are not obviously in-page navigation. */
function siteNavTags(src: string): string[] {
  return (src.match(/<nav\b[^>]*>/gi) ?? []).filter((tag) => !IN_PAGE_NAV.test(tag));
}

export function duplicateChromeFindings(files: ProjectFile[]): ChromeFinding[] {
  const out: ChromeFinding[] = [];
  for (const f of files) {
    if (!/^src\/pages\/.+\.(t|j)sx$/.test(f.path)) continue;
    const src = f.content ?? "";
    if (headerBlocks(src).some((h) => siteNavTags(h).length > 0)) {
      out.push({ path: f.path, reason: `${f.path} renders its own site header with navigation — the shared layout already shows the header, so remove it from the page` });
      continue;
    }
    if (ANNOUNCEMENT_CLASS.test(src)) {
      out.push({ path: f.path, reason: `${f.path} adds an announcement/top bar — the page must start with its own content under the shared header; remove the extra bar` });
    }
  }
  return out;
}
