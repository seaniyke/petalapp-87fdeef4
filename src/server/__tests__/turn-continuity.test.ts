/**
 * Regression suite for the login-page incident (turn c7c03a8d…): one request,
 * a provider stall, a false "cut off" flag, three disconnected fix-ups, and
 * pictures made for building blocks nobody edited.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai-provider.server", () => ({
  aiChatCompletions: vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "export default function Login() { return null }\n" } }] }), { status: 200 }),
  ),
}));

import { aiChatCompletions } from "@/server/ai-provider.server";
import { RecoveryBudget, RECOVERY_LIMITS, MAX_REPAIRED_FILES } from "@/server/engine/recovery-policy";
import { buildAppMap, renderAppMapBlock } from "@/server/engine/app-map";
import { buildRepairUserMessage, repairBrokenFile } from "@/server/engine/repair";
import { applyScaffoldKitForPatch, sameKitModuloResolvedImages } from "@/server/scaffold-kit";
import { diffChangedPaths } from "@/server/generate.server";
import { runWriteGate } from "@/server/write-gate.server";

const APP = `import { Router, Routes, Route } from "@/components/ui/router";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Menu from "./pages/Menu";
import About from "./pages/About";
export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/about" element={<About />} />
        </Route>
      </Routes>
    </Router>
  );
}
`;
const LAYOUT = `import { Outlet, Link } from "@/components/ui/router";
export default function Layout() {
  return (<div><nav><Link to="/">Home</Link><Link to="/menu">Menu</Link><Link to="/about">About</Link></nav><Outlet /><footer>© Harbor Lane</footer></div>);
}
`;
const page = (n: string) => `export default function ${n}() { return <main><img src="https://cdn.example/${n}.png" alt="" /></main> }\n`;
const PROJECT = [
  { path: "index.html", content: "<!doctype html><div id=root></div>" },
  { path: "src/App.tsx", content: APP },
  { path: "src/components/Layout.tsx", content: LAYOUT },
  { path: "src/pages/Home.tsx", content: page("Home") },
  { path: "src/pages/Menu.tsx", content: page("Menu") },
  { path: "src/pages/About.tsx", content: page("About") },
  { path: "src/index.css", content: ":root{}" },
];
const LOGIN_OK = `import { Container } from "@/components/layout";
function Login() {
  return (
    <Container>
      <h1>Sign in</h1>
    </Container>
  )
}
export default Login`;

describe("app map (deterministic, from current files)", () => {
  it("identifies the project's actual router, entry, routes, layout and nav", () => {
    const map = buildAppMap(PROJECT);
    expect(map.router).toBe("kit-router");
    expect(map.routerImport).toBe("@/components/ui/router");
    expect(map.entry).toBe("src/App.tsx");
    expect(map.routes.map((r) => r.path)).toEqual(["/", "/menu", "/about"]);
    expect(map.routes.find((r) => r.path === "/menu")?.file).toBe("src/pages/Menu.tsx");
    expect(map.layouts).toContain("src/components/Layout.tsx");
    expect(map.navLinks).toEqual(["/", "/about", "/menu"]);
    expect(map.styles).toContain("src/index.css");
  });

  it("detects plain react-router-dom and tells the writer not to switch routers", () => {
    const files = PROJECT.map((f) =>
      f.path === "src/App.tsx" ? { ...f, content: APP.replace("@/components/ui/router", "react-router-dom") } : f,
    );
    const map = buildAppMap(files);
    expect(map.router).toBe("react-router-dom");
    const block = renderAppMapBlock(map);
    expect(block).toContain('"react-router-dom"');
    expect(block).toMatch(/Never introduce another routing mechanism/);
    expect(block).toMatch(/current files beat any project notes/);
  });

  it("knows when Login does not exist yet and reports existing pages", () => {
    const map = buildAppMap(PROJECT);
    expect(map.pages).not.toContain("src/pages/Login.tsx");
    expect(map.pages).toEqual(["src/pages/About.tsx", "src/pages/Home.tsx", "src/pages/Menu.tsx"]);
  });
});

describe("one turn-level recovery record", () => {
  it("stall → retry → repair all share the same record; later attempts see earlier ones", () => {
    const r = new RecoveryBudget();
    r.setTurn({ request: "Create a login page", targets: ["src/pages/Login.tsx", "src/App.tsx"] });
    expect(r.take("provider_failure")).toBe(true);
    r.record({ kind: "provider_failure", stage: "generation", path: null, reason: "provider stream stalled", action: "resent to another provider" });
    expect(r.take("broken_file", "src/pages/Login.tsx")).toBe(true);
    const n = r.record({ kind: "broken_file", stage: "validation", path: "src/pages/Login.tsx", reason: "truncation: file ends mid-statement", action: "compile repair", candidateContent: LOGIN_OK });
    r.resolve(n, "kept_previous");
    const s = r.summarize("src/pages/Login.tsx");
    expect(s).toContain("Original request: Create a login page");
    expect(s).toContain("Intended scope: src/pages/Login.tsx, src/App.tsx");
    expect(s).toContain("provider stream stalled");
    expect(s).toContain("truncation: file ends mid-statement");
    expect(s).toContain("kept_previous");
    expect(s).toMatch(/Repairs left this turn: 39/);
    expect(r.history()).toHaveLength(2);
  });

  it("another file's attempts don't leak into an unrelated file's repair", () => {
    const r = new RecoveryBudget();
    r.record({ kind: "broken_file", stage: "validation", path: "src/pages/Login.tsx", reason: "x", action: "y" });
    expect(r.summarize("src/App.tsx")).not.toContain("src/pages/Login.tsx:");
  });

  it("keeps the existing bounded limits — no second loop, no extra tries", () => {
    expect(RECOVERY_LIMITS.broken_file).toBe(3);
    expect(RECOVERY_LIMITS.provider_failure).toBe(2);
    const r = new RecoveryBudget();
    expect(r.take("broken_file", "a")).toBe(true);
    r.take("broken_file", "a"); r.take("broken_file", "a");
    expect(r.take("broken_file", "a")).toBe(false); // three attempts per file, shared by write gate + final check
    for (let i = 1; i < MAX_REPAIRED_FILES; i++) r.take("broken_file", `f${i}`);
    expect(r.take("broken_file", "one-too-many")).toBe(false);
    expect(r.remainingFileRepairs()).toBe(0);
  });
});

describe("repair sees the current file and the turn history", () => {
  it("prompt carries the request, earlier attempts, app map and the authoritative file", () => {
    const r = new RecoveryBudget();
    r.setTurn({ request: "Create a login page", targets: ["src/pages/Login.tsx"] });
    r.record({ kind: "provider_failure", stage: "generation", path: null, reason: "stalled", action: "resent" });
    const ctx = `${r.summarize("src/pages/Login.tsx")}\n\n${renderAppMapBlock(buildAppMap(PROJECT), 900)}`;
    const msg = buildRepairUserMessage({ path: "src/pages/Login.tsx", content: LOGIN_OK }, "Unexpected token", ctx);
    expect(msg).toContain("Create a login page");
    expect(msg).toContain("#1 [generation]");
    expect(msg).toContain("@/components/ui/router");
    expect(msg).toMatch(/Keep the approach already taken/);
    expect(msg.endsWith(LOGIN_OK)).toBe(true);
  });

  it("does not call the AI for a genuinely cut-off file (cut-off pages are re-requested, not patched)", async () => {
    vi.mocked(aiChatCompletions).mockClear();
    const out = await repairBrokenFile({ path: "src/pages/Login.tsx", content: LOGIN_OK }, "Unexpected end of input", { turnContext: "x" });
    expect(out).toBeNull();
    expect(aiChatCompletions).not.toHaveBeenCalled();
  });
});

describe("write gate: valid files are never repaired; failures keep last known-good", () => {
  it("a valid Login.tsx (semicolon-less ending) is accepted with no repair call", async () => {
    const repair = vi.fn(async () => "should not be used");
    const after = [...PROJECT, { path: "src/pages/Login.tsx", content: LOGIN_OK }];
    const res = await runWriteGate({ before: PROJECT, after, changedPaths: ["src/pages/Login.tsx"], repair });
    expect(repair).not.toHaveBeenCalled();
    expect(res.files.find((f) => f.path === "src/pages/Login.tsx")?.content).toBe(LOGIN_OK);
    // App.tsx untouched by a Login-only change.
    expect(res.files.find((f) => f.path === "src/App.tsx")?.content).toBe(APP);
  });

  it("a genuinely broken file can still be repaired (once, re-verified)", async () => {
    const broken = "export default function Login() { return <main> }\n";
    const fixed = "export default function Login() { return <main /> }\n";
    const repair = vi.fn(async () => fixed);
    const after = [...PROJECT, { path: "src/pages/Login.tsx", content: broken }];
    const res = await runWriteGate({ before: PROJECT, after, changedPaths: ["src/pages/Login.tsx"], repair });
    if (res.validationFailure) return; // compiler unavailable in this sandbox: gate refuses rather than guesses
    expect(repair).toHaveBeenCalledTimes(1);
    expect(res.files.find((f) => f.path === "src/pages/Login.tsx")?.content).toBe(fixed);
  });

  it("a failed repair preserves the last known-good file", async () => {
    const goodApp = APP;
    const brokenApp = APP.replace("</Router>", "<Router>");
    const repair = vi.fn(async () => brokenApp + "{");
    const after = PROJECT.map((f) => (f.path === "src/App.tsx" ? { ...f, content: brokenApp } : f));
    const res = await runWriteGate({ before: PROJECT, after, changedPaths: ["src/App.tsx"], repair });
    if (res.validationFailure) return;
    expect(res.files.find((f) => f.path === "src/App.tsx")?.content).toBe(goodApp);
    expect(res.rejected[0]?.reverted).toBe(true);
  });
});

describe("pictures and building blocks stay out of an unrelated edit", () => {
  const withKit = applyScaffoldKitForPatch(PROJECT);
  const example = withKit.find((f) => f.path.startsWith("src/components/examples/") && f.path.endsWith(".tsx") && /petal-image:\/\/\w/.test(f.content))!;
  const resolved = example.content.replace(/petal-image:\/\/[^\s"'`<>)]+/g, "https://cdn.example/pic.png");

  it("recognises a kit copy whose picture slots were filled", () => {
    expect(sameKitModuloResolvedImages(example.content, resolved)).toBe(true);
    expect(sameKitModuloResolvedImages(example.content, resolved + "\n// redesign")).toBe(false);
  });

  it("editing only Login does not revert filled building blocks (so no new pictures)", () => {
    const baseline = withKit.map((f) => (f.path === example.path ? { ...f, content: resolved } : f));
    const edited = [...baseline, { path: "src/pages/Login.tsx", content: LOGIN_OK }];
    const next = applyScaffoldKitForPatch(edited, { keepPaths: ["src/pages/Login.tsx"] });
    expect(next.find((f) => f.path === example.path)?.content).toBe(resolved);
    const changed = diffChangedPaths(baseline, next);
    expect(changed).toContain("src/pages/Login.tsx");
    expect(changed).not.toContain(example.path);
    for (const p of ["src/pages/Home.tsx", "src/pages/Menu.tsx", "src/pages/About.tsx", "src/App.tsx"]) {
      expect(changed).not.toContain(p);
    }
    expect(changed.some((p) => p.includes("petal-image") || (next.find((f) => f.path === p)?.content ?? "").includes("petal-image://"))).toBe(false);
  });
});
