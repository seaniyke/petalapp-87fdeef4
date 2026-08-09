/**
 * Orphan-page wiring.
 *
 * Failure mode this fixes (observed on real builds): the model writes
 * `src/pages/MyPlants.tsx` and `src/pages/CareTips.tsx`, but `src/App.tsx`
 * only declares `<Route path="/" element={<Home />} />`. The build succeeds,
 * the pages exist in the repo, and the user sees a landing page with no way
 * to reach anything — "it only built the landing page".
 *
 * Deterministic repair: any page module under `src/pages/` (or `src/screens/`)
 * that no router file imports gets an import, a `<Route>` entry before the
 * wildcard, and — when a NavBar `links={[...]}` array is present — a nav link.
 *
 * Pure ProjectFile[] → ProjectFile[]. No I/O, no model calls. Conservative:
 * bails out entirely when the router file shape is not recognisable.
 */

import type { ProjectFile } from "./generate.server";

const PAGE_DIR = /^src\/(pages|screens)\/([A-Za-z0-9_-]+)\.(tsx|jsx)$/;
const SKIP_PAGE = /^(not-?found|404|index|home|landing|app|layout)$/i;

export interface OrphanPageWiringResult {
  files: ProjectFile[];
  notes: string[];
  wired: string[];
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function titleize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Component name exported by a page module, if we can tell. */
function exportedComponent(src: string, fallback: string): string | null {
  const named = src.match(
    /export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/,
  );
  if (named?.[1]) return named[1];
  if (/export\s+default\s/.test(src)) return fallback;
  return null;
}

function isDefaultExport(src: string, component: string): boolean {
  if (new RegExp(`export\\s+default\\s+(function|class)\\s+${component}\\b`).test(src)) return true;
  if (new RegExp(`export\\s+default\\s+${component}\\s*;`).test(src)) return true;
  return /export\s+default\s/.test(src) && !new RegExp(`export\\s+(const|function|class)\\s+${component}\\b`).test(src);
}

export function wireOrphanPages(files: ProjectFile[]): OrphanPageWiringResult {
  const notes: string[] = [];
  const wired: string[] = [];

  const routerFile = files.find(
    (f) => /\.(tsx|jsx)$/.test(f.path) && /<Routes\b/.test(f.content) && /<Route\b/.test(f.content),
  );
  if (!routerFile) return { files, notes, wired };

  const pages = files.filter((f) => {
    const m = f.path.match(PAGE_DIR);
    return Boolean(m && !SKIP_PAGE.test(m[2] ?? ""));
  });
  if (!pages.length) return { files, notes, wired };

  let content = routerFile.content;
  const declaredPaths = new Set(
    Array.from(content.matchAll(/<Route\b[^>]*\bpath\s*=\s*["']([^"']+)["']/g)).map((m) =>
      (m[1] ?? "").toLowerCase(),
    ),
  );

  const additions: { importLine: string; route: string; label: string; path: string }[] = [];

  for (const page of pages) {
    const base = page.path.match(PAGE_DIR)?.[2] ?? "";
    const component = exportedComponent(page.content, base);
    if (!component) continue;
    // Already imported by the router? Then it is wired (or intentionally used).
    if (new RegExp(`\\b${component}\\b`).test(content)) continue;

    const slug = `/${kebab(base)}`;
    if (declaredPaths.has(slug)) continue;
    declaredPaths.add(slug);

    const spec = `./${page.path.replace(/^src\//, "").replace(/\.(tsx|jsx)$/, "")}`;
    const importLine = isDefaultExport(page.content, component)
      ? `import ${component} from "${spec}";`
      : `import { ${component} } from "${spec}";`;

    additions.push({
      importLine,
      route: `              <Route path="${slug}" element={<${component} />} />`,
      label: titleize(base),
      path: slug,
    });
  }

  if (!additions.length) return { files, notes, wired };

  // 1. Imports — after the last existing import line.
  const importMatches = Array.from(content.matchAll(/^import\s.+$/gm));
  const last = importMatches[importMatches.length - 1];
  if (!last || last.index === undefined) return { files, notes, wired };
  const insertAt = last.index + last[0].length;
  content =
    content.slice(0, insertAt) +
    "\n" +
    additions.map((a) => a.importLine).join("\n") +
    content.slice(insertAt);

  // 2. Routes — before a wildcard route when present, else before </Routes>.
  const routeBlock = additions.map((a) => a.route).join("\n");
  const wildcard = content.match(/^[ \t]*<Route\b[^>]*path\s*=\s*["']\*["'][^>]*\/>\s*$/m);
  if (wildcard && wildcard.index !== undefined) {
    content =
      content.slice(0, wildcard.index) + routeBlock + "\n" + content.slice(wildcard.index);
  } else {
    const closeIdx = content.indexOf("</Routes>");
    if (closeIdx === -1) return { files, notes, wired };
    const lineStart = content.lastIndexOf("\n", closeIdx) + 1;
    content = content.slice(0, lineStart) + routeBlock + "\n" + content.slice(lineStart);
  }

  // 3. Nav links — best effort, only for a literal `links={[ ... ]}` array.
  const navLinks = content.match(/links\s*=\s*\{\s*\[/);
  if (navLinks && navLinks.index !== undefined) {
    const insert = navLinks.index + navLinks[0].length;
    const newLinks = additions
      .filter((a) => !content.includes(`"${a.path}"`) || true)
      .map((a) => `\n              { href: "${a.path}", label: "${a.label}" },`)
      .join("");
    content = content.slice(0, insert) + newLinks + content.slice(insert);
  }

  const nextFiles = files.map((f) =>
    f.path === routerFile.path ? { ...f, content } : f,
  );
  for (const a of additions) wired.push(a.path);
  notes.push(
    `orphan-page-wiring: routed ${wired.length} unreachable page(s) in ${routerFile.path} (${wired.join(", ")})`,
  );

  return { files: nextFiles, notes, wired };
}
