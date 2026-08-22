/**
 * Deterministic entry-trio + root-view safety net.
 *
 * Extracted from src/routes/api/generate.ts so both the monolithic path
 * and the staged pipeline (stage-wireup) can call it. The contract is:
 *
 *   - index.html and src/main.tsx are ALWAYS injected if missing — Petal
 *     owns those; the model never has to write them.
 *   - src/App.tsx is only patched as a last-resort placeholder when the
 *     model truly produced no root view. The placeholder is marked in
 *     `degraded` so the caller can decide whether to ship it or fall
 *     back to a real second attempt.
 */

import type { ProjectFile } from "@/server/generate.server";

export interface RenderableShellResult {
  files: ProjectFile[];
  /** Paths Petal had to inject/repair. */
  fixed: string[];
  /**
   * Paths where the model produced nothing real and we fell back to a
   * placeholder. Today only "src/App.tsx" can appear here. Callers
   * SHOULD treat this as a degraded result (telemetry, fallback path).
   */
  degraded: string[];
}

/** Regex matching the "is being prepared" placeholder we inject below. */
export const ROOT_PLACEHOLDER_RE =
  /(is being prepared|first generation didn't ship a root view|first generation didn't ship a homepage)/i;

/**
 * Decide whether App.tsx truly has no usable root view.
 *
 * This deliberately considers the whole file: a nested component may contain
 * a normal `return null` guard while the default App still renders substantial
 * JSX. The old unanchored `return null` regex classified those healthy apps as
 * blank and caused fresh projects to be rolled back wholesale.
 */
export function isMissingRootView(source: string): boolean {
  if (!source.trim()) return true;
  if (ROOT_PLACEHOLDER_RE.test(source)) return true;
  if (/PlaceholderIndex|data-lovable-blank-page-placeholder/i.test(source)) return true;

  const rendersJsx = /<[A-Za-z][\w.:-]*(?:\s|>|\/)/.test(source);
  return !rendersJsx;
}

const VIEW_SOURCE = /\.(tsx|jsx)$/i;
const KIT_OWNED =
  /^src\/(components\/(ui|blocks|examples|fx|motion|mobile|three|content|providers|scroll|image|charts|data|forms|editor|map)\/|integrations\/|hooks\/|lib\/)/;
const PAGE_DIR = /^src\/(pages|screens|views)\/[^/]+\.(tsx|jsx)$/i;
const SECTION_DIR =
  /^src\/components\/(sections|section|landing|marketing|home)\/[^/]+\.(tsx|jsx)$/i;
const TOP_LEVEL_COMPONENT = /^src\/components\/[^/]+\.(tsx|jsx)$/i;

function baseOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(tsx?|jsx?)$/i, "");
}

function pascal(base: string): string {
  return base
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function exportedName(source: string, path: string): { name: string; isDefault: boolean } | null {
  const def = source.match(/export\s+default\s+(?:function\s+)?([A-Z][A-Za-z0-9_]*)/);
  if (def) return { name: def[1], isDefault: true };
  if (/export\s+default\s/.test(source)) {
    const name = pascal(baseOf(path));
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return { name, isDefault: true };
  }
  const named = source.match(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/);
  if (named) return { name: named[1], isDefault: false };
  return null;
}

function propsFree(source: string, name: string): boolean {
  const re = new RegExp(
    `(?:function\\s+${name}\\s*\\(([^)]*)\\)|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:React\\.)?(?:memo\\s*\\(\\s*)?\\(([^)]*)\\)\\s*=>)`,
  );
  const m = source.match(re);
  if (!m) return true;
  const params = (m[1] ?? m[2] ?? "").trim();
  if (!params) return true;
  const inner = params.replace(/^\{/, "").replace(/\}\s*(:[\s\S]*)?$/, "");
  const parts = inner.split(/,(?![^{[]*[}\]])/).map((p) => p.trim()).filter(Boolean);
  return parts.every((p) => p.includes("=") || p.startsWith("..."));
}

function rank(base: string): number {
  const b = base.toLowerCase();
  if (/hero|banner|masthead/.test(b)) return 0;
  if (/logo|social-proof|proof|trusted|stats/.test(b)) return 1;
  if (/feature|benefit|service|product|catalog|row|list|menu|about|story|process|how/.test(b)) return 2;
  if (/gallery|showcase|work|portfolio/.test(b)) return 3;
  if (/testimonial|review|quote/.test(b)) return 4;
  if (/pricing|plan/.test(b)) return 5;
  if (/faq|question/.test(b)) return 6;
  if (/cta|contact|newsletter|signup|subscribe/.test(b)) return 8;
  return 7;
}

function routeFor(base: string): string {
  const b = base.toLowerCase();
  if (/^(index|home|landing|main|app)$/.test(b)) return "/";
  return "/" + b.replace(/page$/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

/**
 * Build a real root view out of the pages/sections the turn actually wrote.
 * Returns null only when there is genuinely nothing renderable.
 */
export function composeRootApp(byPath: Map<string, string>): string | null {
  const pages: Array<{ path: string; base: string; name: string; isDefault: boolean }> = [];
  const sections: Array<{ path: string; base: string; name: string; isDefault: boolean }> = [];
  let nav: { name: string; isDefault: boolean; path: string } | null = null;
  let footer: { name: string; isDefault: boolean; path: string } | null = null;

  for (const [p, content] of byPath) {
    if (!VIEW_SOURCE.test(p) || KIT_OWNED.test(p)) continue;
    if (!/<[A-Za-z]/.test(content)) continue;
    const exp = exportedName(content, p);
    if (!exp) continue;
    const base = baseOf(p);
    if (PAGE_DIR.test(p)) {
      pages.push({ path: p, base, name: exp.name, isDefault: exp.isDefault });
      continue;
    }
    if (/^(nav-?bar|navigation|site-?nav|site-?header|header)$/i.test(base)) {
      nav = { ...exp, path: p };
      continue;
    }
    if (/^(footer|site-?footer)$/i.test(base)) {
      footer = { ...exp, path: p };
      continue;
    }
    if ((SECTION_DIR.test(p) || TOP_LEVEL_COMPONENT.test(p)) && propsFree(content, exp.name)) {
      sections.push({ path: p, base, name: exp.name, isDefault: exp.isDefault });
    }
  }

  const imp = (m: { name: string; isDefault: boolean; path: string }) =>
    m.isDefault
      ? `import ${m.name} from "@/${m.path.replace(/^src\//, "").replace(/\.(tsx|jsx)$/i, "")}";`
      : `import { ${m.name} } from "@/${m.path.replace(/^src\//, "").replace(/\.(tsx|jsx)$/i, "")}";`;

  const header = `// Composed by Petal: the generation didn't ship src/App.tsx, so the\n// pages/sections it did write are mounted here.\n`;

  if (pages.length > 0) {
    const seen = new Set<string>();
    const unique = pages.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
    const routes = unique.map((p) => ({ ...p, route: routeFor(p.base) }));
    if (!routes.some((r) => r.route === "/")) routes[0].route = "/";
    const imports = [
      `import { BrowserRouter, Routes, Route } from "react-router-dom";`,
      ...(nav ? [imp(nav)] : []),
      ...(footer ? [imp(footer)] : []),
      ...routes.map((r) => imp(r)),
    ].join("\n");
    const routeJsx = routes
      .map((r) => `          <Route path="${r.route}" element={<${r.name} />} />`)
      .join("\n");
    return (
      `${header}${imports}\n\n` +
      `export default function App() {\n` +
      `  return (\n` +
      `    <BrowserRouter>\n` +
      `      <div className="min-h-screen bg-background text-foreground">\n` +
      (nav ? `        <${nav.name} />\n` : "") +
      `        <Routes>\n${routeJsx}\n        </Routes>\n` +
      (footer ? `        <${footer.name} />\n` : "") +
      `      </div>\n` +
      `    </BrowserRouter>\n` +
      `  );\n}\n`
    );
  }

  if (sections.length === 0) return null;
  sections.sort((a, b) => rank(a.base) - rank(b.base) || a.base.localeCompare(b.base));
  const seen = new Set<string>();
  const unique = sections
    .filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
    .slice(0, 14);
  const imports = [...(nav ? [imp(nav)] : []), ...unique.map((s) => imp(s)), ...(footer ? [imp(footer)] : [])].join(
    "\n",
  );
  const body = unique.map((s) => `        <${s.name} />`).join("\n");
  return (
    `${header}${imports}\n\n` +
    `export default function App() {\n` +
    `  return (\n` +
    `    <div className="min-h-screen bg-background text-foreground">\n` +
    (nav ? `      <${nav.name} />\n` : "") +
    `      <main>\n${body}\n      </main>\n` +
    (footer ? `      <${footer.name} />\n` : "") +
    `    </div>\n` +
    `  );\n}\n`
  );
}

export function ensureRenderableShell(
  files: ProjectFile[],
  subtypeHint?: import("@/lib/web-subtype").WebSubtype,
): RenderableShellResult {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const fixed: string[] = [];
  const degraded: string[] = [];

  if (!byPath.has("index.html")) {
    byPath.set(
      "index.html",
      '<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>App</title></head>\n  <body><div id="root"></div><script>(function(){var lastErr=null;window.addEventListener("error",function(e){lastErr=e.error||e.message;});window.addEventListener("unhandledrejection",function(e){lastErr=e.reason;});setTimeout(function(){var r=document.getElementById("root");if(r&&r.childElementCount===0){r.innerHTML=\'<main style="min-height:100vh;padding:48px 24px;font-family:ui-sans-serif,system-ui;background:#0b0b10;color:#f5f5f7"><div style="max-width:720px;margin:0 auto"><p style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:.6;margin:0">Preview blank</p><h1 style="font-size:28px;font-weight:700;margin:8px 0 16px">The app mounted but rendered nothing.</h1><p style="opacity:.7;margin:0 0 16px">\'+(lastErr?String(lastErr.message||lastErr):"No error was thrown — the root component returned no visible JSX.")+\'</p>\'+(lastErr&&lastErr.stack?\'<pre style="background:#15151c;border:1px solid #2a2a35;border-radius:8px;padding:16px;font-size:12px;overflow:auto;color:#cfcfd6">\'+lastErr.stack+\'</pre>\':"")+\'</div></main>\';}},2500);})();</script><script type="module" src="/src/main.tsx"></script></body>\n</html>\n',
    );
    fixed.push("index.html");
  }

  const main = byPath.get("src/main.tsx") ?? "";
  if (!/createRoot\s*\(|\.render\s*\(/.test(main)) {
    byPath.set(
      "src/main.tsx",
      'import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\nclass __PetalErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {\n  state = { error: null as Error | null };\n  static getDerivedStateFromError(error: Error) { return { error }; }\n  componentDidCatch(error: Error) { console.error("[petal] render error", error); }\n  render() {\n    if (this.state.error) {\n      return (\n        <main style={{ minHeight: "100vh", padding: "48px 24px", fontFamily: "ui-sans-serif, system-ui", background: "#0b0b10", color: "#f5f5f7" }}>\n          <div style={{ maxWidth: 720, margin: "0 auto" }}>\n            <p style={{ fontSize: 13, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6, margin: 0 }}>Render error</p>\n            <h1 style={{ fontSize: 28, fontWeight: 700, margin: "8px 0 16px" }}>This screen failed to render.</h1>\n            <p style={{ opacity: 0.7, margin: "0 0 16px" }}>{String(this.state.error?.message ?? this.state.error)}</p>\n            <pre style={{ background: "#15151c", border: "1px solid #2a2a35", borderRadius: 8, padding: 16, fontSize: 12, overflow: "auto", color: "#cfcfd6" }}>{this.state.error?.stack}</pre>\n          </div>\n        </main>\n      );\n    }\n    return this.props.children;\n  }\n}\n\nReactDOM.createRoot(document.getElementById("root")!).render(\n  <React.StrictMode>\n    <__PetalErrorBoundary>\n      <App />\n    </__PetalErrorBoundary>\n  </React.StrictMode>,\n);\n',
    );
    fixed.push("src/main.tsx");
  }

  const app = byPath.get("src/App.tsx") ?? "";
  if (isMissingRootView(app)) {
    // ROOT-CAUSE RECOVERY: in almost every "home screen came back empty"
    // report the model DID write real pages/sections — it just never wrote
    // (or truncated) src/App.tsx. Compose the root view from what exists
    // before falling back to a placeholder + turn rollback.
    const composed = composeRootApp(byPath);
    if (composed) {
      byPath.set("src/App.tsx", composed);
      fixed.push("src/App.tsx");
      return {
        files: Array.from(byPath, ([path, content]) => ({ path, content })),
        fixed,
        degraded,
      };
    }
  }
  if (isMissingRootView(app)) {
    const eyebrow =
      subtypeHint === "marketing" ? "Landing page" :
      subtypeHint === "fullstack" ? "Platform" :
      "Web app";
    const headline =
      subtypeHint === "marketing" ? "Your landing page is being prepared" :
      subtypeHint === "fullstack" ? "Your platform is being prepared" :
      "Your app is being prepared";
    const sub =
      subtypeHint === "marketing"
        ? "The first generation didn't ship a homepage. Ask Petal to retry — the next turn will scaffold the hero, features, and footer."
        : "The first generation didn't ship a root view. Ask Petal to retry and your screens will appear here.";
    byPath.set(
      "src/App.tsx",
      `export default function App() {\n  return (\n    <main className="min-h-screen bg-background px-6 py-16 text-foreground">\n      <section className="mx-auto max-w-3xl space-y-4">\n        <p className="text-sm font-medium text-muted-foreground">${eyebrow}</p>\n        <h1 className="text-4xl font-bold tracking-tight">${headline}</h1>\n        <p className="text-lg text-muted-foreground">${sub}</p>\n      </section>\n    </main>\n  );\n}\n`,
    );
    fixed.push("src/App.tsx");
    degraded.push("src/App.tsx");
  }

  return {
    files: Array.from(byPath, ([path, content]) => ({ path, content })),
    fixed,
    degraded,
  };
}
