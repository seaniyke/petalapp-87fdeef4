import { describe, it, expect } from "vitest";
import {
  syntaxGate,
  dependencyGate,
  routesGate,
  buildGate,
  browserGate,
  finalizeVerification,
  runSourceGates,
  guardCleanup,
  isUnfinishedPage,
  MAX_REPAIR_TARGETS,
} from "@/server/verification/gates";
import { shouldRepair } from "@/server/execution/verdict";
import { runWriteGate } from "@/server/write-gate.server";

const pkg = { path: "package.json", content: JSON.stringify({ dependencies: { react: "19", "react-router-dom": "6" } }) };
const app = {
  path: "src/App.tsx",
  content: `import { Routes, Route } from "react-router-dom";\nimport Home from "./pages/Home";\nimport About from "./pages/About";\nexport default function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/about" element={<About/>}/></Routes>}`,
};
const home = { path: "src/pages/Home.tsx", content: `export default function Home(){return <main><h1>Fresh bread, baked at dawn</h1><p>Visit our shop on Harbor Lane.</p></main>}` };
const about = { path: "src/pages/About.tsx", content: `export default function About(){return <main><h1>Our story</h1><p>Three generations of bakers.</p></main>}` };
const valid = [pkg, app, home, about];
const ok = { status: "passed", issues: [] };

describe("valid builds reach READY", () => {
  it("all gates pass → READY", () => {
    const r = finalizeVerification([...runSourceGates({ files: valid, requestedRoutes: ["/", "/about"], esbuild: ok }), buildGate("succeeded"), browserGate({ verdict: "ready", reasons: [] })]);
    expect(r.status).toBe("READY");
  });
  it("warnings do not block READY", () => {
    const withExtra = [...valid, { path: "src/pages/Extra.tsx", content: `import dayjs from "dayjs";\nexport default function E(){return <p>Extra page text here</p>}` }];
    const g = dependencyGate(withExtra);
    expect(g.verdict).toBe("WARNING");
    const r = finalizeVerification([syntaxGate(ok), g, routesGate(withExtra, []), buildGate("succeeded"), browserGate({ verdict: "ready", reasons: [] })]);
    expect(r.status).toBe("READY");
  });
});

describe("failed builds never become READY", () => {
  it("build failure → FAILED with a record", () => {
    const r = finalizeVerification([...runSourceGates({ files: valid, requestedRoutes: [], esbuild: ok }), buildGate("failed", "vite: cannot resolve x"), browserGate({ verdict: "ready", reasons: [] })]);
    expect(r.status).toBe("FAILED");
    expect(r.failedGate).toBe("build");
    expect(r.reason).toContain("cannot resolve");
  });
  it("successful build with a missing requested page is not READY", () => {
    const r = finalizeVerification([...runSourceGates({ files: valid, requestedRoutes: ["/", "/about", "/contact"], esbuild: ok }), buildGate("succeeded"), browserGate({ verdict: "ready", reasons: [] })]);
    expect(r.status).toBe("FAILED");
    expect(r.failedGate).toBe("routes");
  });
  it("browser fault on the deployed app → FAILED", () => {
    const r = finalizeVerification([...runSourceGates({ files: valid, requestedRoutes: [], esbuild: ok }), buildGate("succeeded"), browserGate({ verdict: "not_ready", reasons: ["blank page"] })]);
    expect(r).toMatchObject({ status: "FAILED", failedGate: "browser" });
  });
  it("first failing gate in pipeline order wins", () => {
    const r = finalizeVerification([buildGate("failed"), syntaxGate({ status: "failed", issues: [{ path: "src/App.tsx", message: "Unexpected }" }] })]);
    expect(r.failedGate).toBe("syntax");
    expect(r.repairTargets).toEqual(["src/App.tsx"]);
  });
});

describe("unavailable verifier preserves code", () => {
  it("UNAVAILABLE syntax check is not FAIL, not repaired, not READY", () => {
    const g = syntaxGate({ status: "unavailable" });
    expect(g.verdict).toBe("UNAVAILABLE");
    expect(shouldRepair(g.verdict)).toBe(false);
    const r = finalizeVerification([g, dependencyGate(valid), routesGate(valid, []), buildGate("succeeded"), browserGate({ verdict: "ready", reasons: [] })]);
    expect(r.status).toBe("UNVERIFIED");
    expect(r.repairTargets).toEqual([]);
  });
  it("could-not-check browser stays UNVERIFIED, never FAIL", () => {
    const r = finalizeVerification([...runSourceGates({ files: valid, requestedRoutes: [], esbuild: ok }), buildGate("succeeded"), browserGate({ verdict: "unverified", reasons: ["test lab down"] })]);
    expect(r.status).toBe("UNVERIFIED");
  });
  it("build not finished → IN_PROGRESS, never READY", () => {
    const r = finalizeVerification(runSourceGates({ files: valid, requestedRoutes: [], esbuild: ok }));
    expect(r.status).toBe("IN_PROGRESS");
  });
});

describe("false-positive regression: JSX prose", () => {
  const prose = {
    path: "src/pages/Home.tsx",
    content: `export default function Home(){return <main><h1>We're open</h1><p>Don't miss it — it hasn't sold out, and you'll love Mom's bread.</p></main>}`,
  };
  it("the write gate keeps valid JSX with apostrophes (no quarantine)", async () => {
    const res = await runWriteGate({ before: [], after: [prose], changedPaths: [prose.path] });
    expect(res.rejected).toEqual([]);
    expect(res.files).toContainEqual(prose);
  });
  it("a clean authoritative verdict is PASS regardless of heuristics", () => {
    expect(syntaxGate(ok).verdict).toBe("PASS");
  });
  it("a real syntax error is FAIL with the smallest scope", () => {
    const g = syntaxGate({ status: "failed", issues: [{ path: "src/pages/Home.tsx", message: "Unterminated string", line: 3 }] });
    expect(g.verdict).toBe("FAIL");
    expect(g.paths).toEqual(["src/pages/Home.tsx"]);
  });
});

describe("dependency and route defects", () => {
  it("broken local import → FAIL on the importing file", () => {
    const bad = [...valid, { path: "src/pages/Menu.tsx", content: `import Card from "../components/Card";\nexport default function M(){return <Card/>}` }];
    const g = dependencyGate(bad);
    expect(g.verdict).toBe("FAIL");
    expect(g.paths).toEqual(["src/pages/Menu.tsx"]);
  });
  it("invalid package.json → FAIL", () => {
    expect(dependencyGate([{ path: "package.json", content: '{"n"version": 1}' }]).verdict).toBe("FAIL");
  });
  it("route rendering an unimported component → FAIL", () => {
    const badApp = { path: "src/App.tsx", content: `import { Routes, Route } from "react-router-dom";\nexport default function App(){return <Routes><Route path="/x" element={<Ghost/>}/></Routes>}` };
    expect(routesGate([pkg, badApp], []).verdict).toBe("FAIL");
  });
  it("placeholder page → FAIL; real page mentioning 'coming soon' is fine", () => {
    expect(isUnfinishedPage(`export default function A(){return <div>Coming soon</div>}`)).toBe(true);
    expect(isUnfinishedPage(`export default function A(){ return null; }`)).toBe(true);
    const real = `export default function A(){return <main>${"<section><h2>Menu</h2><p>Sourdough, rye and seasonal loaves baked daily.</p></section>".repeat(12)}<p>New pastries coming soon.</p></main>}`;
    expect(isUnfinishedPage(real)).toBe(false);
    const withPlaceholder = [pkg, app, home, { path: "src/pages/About.tsx", content: `export default function About(){return <div>Lorem ipsum</div>}` }];
    expect(routesGate(withPlaceholder, []).verdict).toBe("FAIL");
  });
});

describe("bounded repair", () => {
  it("repair targets are capped", () => {
    const g = syntaxGate({ status: "failed", issues: ["a", "b", "c", "d", "e"].map((p) => ({ path: `src/${p}.tsx`, message: "x" })) });
    expect(finalizeVerification([g]).repairTargets).toHaveLength(MAX_REPAIR_TARGETS);
  });
  it("non-FAIL verdicts never produce repair targets", () => {
    const r = finalizeVerification([syntaxGate({ status: "unavailable" }), buildGate("unavailable")]);
    expect(r.repairTargets).toEqual([]);
  });
});

describe("cleanup cannot rewrite unrelated files", () => {
  it("reverts out-of-scope edits, keeps allowed ones", () => {
    const before = [{ path: "a.tsx", content: "a" }, { path: "b.tsx", content: "b" }];
    const after = [{ path: "a.tsx", content: "A" }, { path: "b.tsx", content: "B" }];
    const r = guardCleanup(before, after, ["a.tsx"]);
    expect(r.reverted).toEqual(["b.tsx"]);
    expect(r.files).toEqual([{ path: "a.tsx", content: "A" }, { path: "b.tsx", content: "b" }]);
  });
  it("restores files cleanup deleted and drops files it invented", () => {
    const r = guardCleanup([{ path: "a.tsx", content: "a" }], [{ path: "z.tsx", content: "z" }], []);
    expect(r.files).toEqual([{ path: "a.tsx", content: "a" }]);
    expect(r.reverted.sort()).toEqual(["a.tsx", "z.tsx"]);
  });
});
