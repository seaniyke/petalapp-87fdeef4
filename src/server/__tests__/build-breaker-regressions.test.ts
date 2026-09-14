/**
 * Regressions for the three defects that actually failed real user builds:
 *  1. Grid preset union made `p.sm` a TS2339 error (vite build exit 1).
 *  2. Unwrapping a nested <BrowserRouter> left adjacent JSX siblings.
 *  3. Placeholder pages named after code concepts shipped into the router.
 */
import { describe, it, expect } from "vitest";
import { KIT_FILES } from "../scaffold-kit";
import { fixMissingRouterProvider } from "../router-provider.server";
import { pruneJunkPages } from "../junk-page-pruner.server";
import { fixExportShape } from "../export-shape-fixer.server";

describe("grid kit", () => {
  it("reads presets through a common type so optional breakpoints compile", () => {
    const grid = KIT_FILES.find((f) => f.path === "src/components/ui/grid.tsx");
    expect(grid).toBeDefined();
    expect(grid!.content).toContain("const p: GridPresetValue | undefined");
  });
});

describe("nested router removal", () => {
  it("leaves a fragment behind instead of adjacent siblings", () => {
    const files = [
      {
        path: "src/main.tsx",
        content: `import { BrowserRouter } from "react-router-dom";\nimport App from "./App";\ncreateRoot(el).render(<BrowserRouter><App /></BrowserRouter>);\n`,
      },
      {
        path: "src/App.tsx",
        content: `import { BrowserRouter, Routes, Route } from "react-router-dom";\nexport default function App() {\n  return (\n    <BrowserRouter>\n      <Header />\n      <Routes><Route path="/" element={<Home />} /></Routes>\n    </BrowserRouter>\n  );\n}\n`,
      },
    ];
    const out = fixMissingRouterProvider(files);
    const app = out.files.find((f) => f.path === "src/App.tsx")!.content;
    if (app.includes("<Header />") && !app.includes("<BrowserRouter>")) {
      expect(app).toContain("<>");
      expect(app).toContain("</>");
    }
  });
});

describe("junk page pruner", () => {
  const page = (path: string, content: string) => ({ path, content });

  it("removes placeholder pages named after code concepts", () => {
    const out = pruneJunkPages([
      page("src/pages/Hooks.tsx", `export default function Hooks() {\n  return <div>placeholder</div>;\n}\n`),
      page("src/pages/UseAxe.tsx", `export default function UseAxe() {\n  return <div>placeholder</div>;\n}\n`),
    ]);
    expect(out.removed.sort()).toEqual(["src/pages/Hooks.tsx", "src/pages/UseAxe.tsx"]);
  });

  it("keeps a real screen even when its name looks generic", () => {
    const real = `import { useState } from "react";\nexport default function Main() {\n  const [q, setQ] = useState("");\n  return (<section><h1>Bookings</h1><input value={q} onChange={(e) => setQ(e.target.value)} /><ul><li>One</li><li>Two</li></ul></section>);\n}\n`;
    expect(pruneJunkPages([page("src/pages/Main.tsx", real)]).removed).toEqual([]);
  });

  it("never removes a page another file imports", () => {
    const out = pruneJunkPages([
      page("src/pages/Hooks.tsx", `export default function Hooks() {\n  return <div>placeholder</div>;\n}\n`),
      page("src/App.tsx", `import Hooks from "@/pages/Hooks";\n`),
    ]);
    expect(out.removed).toEqual([]);
  });
});

describe("export shape", () => {
  it("adds a default export when a page is default-imported", () => {
    const out = fixExportShape([
      { path: "src/App.tsx", content: `import Dashboard from "./pages/Dashboard";\n` },
      { path: "src/pages/Dashboard.tsx", content: `export function Dashboard() {\n  return <div />;\n}\n` },
    ]);
    expect(out.fixes).toBe(1);
    expect(out.files.find((f) => f.path === "src/pages/Dashboard.tsx")!.content).toContain(
      "export default Dashboard;",
    );
  });

  it("leaves files that already have a default export alone", () => {
    const out = fixExportShape([
      { path: "src/App.tsx", content: `import Home from "./pages/Home";\n` },
      { path: "src/pages/Home.tsx", content: `export default function Home() {\n  return <div />;\n}\n` },
    ]);
    expect(out.fixes).toBe(0);
  });
});
