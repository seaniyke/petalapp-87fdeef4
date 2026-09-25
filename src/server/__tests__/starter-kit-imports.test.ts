/**
 * Regression (first live run, Sept 2026): a brand-new project without a
 * backend received three example files importing "@/integrations/backend/auth"
 * — a module that only exists when a backend kit is installed — so source
 * verification rejected every first build. Every starter tree, in every
 * backend configuration, must be import-complete on its own.
 */
import { describe, expect, it } from "vitest";
import { applyScaffoldKit, applyScaffoldKitForPatch } from "@/server/scaffold-kit";
import { BACKEND_EXAMPLES_PACK, EXAMPLES_PACK } from "@/server/examples-pack";

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
const SHELL = [{ path: "src/App.tsx", content: "export default function App(){return null}\n" }];

function normalize(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Every "@/..." and relative import inside a starter file that does not resolve in the tree. */
function unresolvedImports(files: Array<{ path: string; content: string }>): string[] {
  const paths = new Set(files.map((f) => f.path));
  const bad: string[] = [];
  for (const f of files) {
    if (!/\.(t|j)sx?$/.test(f.path)) continue;
    const re = /(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
    for (const m of f.content.matchAll(re)) {
      const spec = m[1] ?? m[2]!;
      let base: string | null = null;
      if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
      else if (spec.startsWith(".")) base = normalize([...f.path.split("/").slice(0, -1), ...spec.split("/")]);
      if (!base || /\.(css|json|svg|png|jpe?g|webp|md)(\?.*)?$/.test(base)) continue;
      if (!EXTS.some((e) => paths.has(base + e))) bad.push(`${f.path} → ${spec}`);
    }
  }
  return bad;
}

const backendAuthImporters = (files: Array<{ path: string; content: string }>) =>
  files.filter((f) => /["']@\/integrations\/backend\//.test(f.content) && !f.path.startsWith("src/integrations/backend/")).map((f) => f.path);

describe("starter kit — import completeness", () => {
  it("the always-shipped examples pack never imports the backend module", () => {
    expect(backendAuthImporters(EXAMPLES_PACK)).toEqual([]);
  });

  it("the three backend-dependent examples live only in the backend pack", () => {
    expect(BACKEND_EXAMPLES_PACK.map((f) => f.path).sort()).toEqual([
      "src/components/examples/auth-forgot-password.tsx",
      "src/components/examples/auth-reset-password.tsx",
      "src/components/examples/onboarding-flow.tsx",
    ]);
  });

  it("a new project WITHOUT a backend gets an import-complete starter tree", () => {
    const tree = applyScaffoldKit(SHELL);
    expect(tree.some((f) => f.path === "src/components/examples/auth-forgot-password.tsx")).toBe(false);
    expect(backendAuthImporters(tree)).toEqual([]);
    expect(unresolvedImports(tree)).toEqual([]);
  });

  it("an edit to a project without a backend never re-adds the backend examples", () => {
    const tree = applyScaffoldKitForPatch(SHELL);
    expect(backendAuthImporters(tree)).toEqual([]);
    expect(unresolvedImports(tree)).toEqual([]);
  });

  it("a project WITH a backend gets the examples together with the module they import", () => {
    const tree = applyScaffoldKit(SHELL, { backend: { url: "https://example.invalid", anonKey: "anon" } });
    for (const f of BACKEND_EXAMPLES_PACK) expect(tree.some((t) => t.path === f.path)).toBe(true);
    expect(tree.some((f) => f.path === "src/integrations/backend/auth.tsx")).toBe(true);
    expect(unresolvedImports(tree)).toEqual([]);
  });

  it("a shared-backend project stays import-complete (no password-reset examples on that tier)", () => {
    const tree = applyScaffoldKit(SHELL, {
      sharedBackend: { projectId: "p", apiKey: "k", baseUrl: "https://example.invalid" },
    });
    expect(tree.some((f) => f.path === "src/components/examples/auth-reset-password.tsx")).toBe(false);
    expect(unresolvedImports(tree)).toEqual([]);
  });
});
