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

export function ensureRenderableShell(
  files: ProjectFile[],
  subtypeHint?: "marketing" | "app" | "fullstack",
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
  if (
    !app.trim() ||
    /PlaceholderIndex|data-lovable-blank-page-placeholder|REPLACE this/i.test(app) ||
    /return\s+(?:null|<><\/>)\s*;/.test(app)
  ) {
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
