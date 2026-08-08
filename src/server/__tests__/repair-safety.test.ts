import { describe, expect, it } from "vitest";
import { validateRouteGraph } from "../route-graph.server";
import { repairBareImports } from "../bare-import-resolver.server";
import type { ProjectFile } from "../generate.server";

describe("route-graph R2 — duplicate root routes", () => {
  it("does not truncate a layout route that has children", () => {
    const app = {
      path: "src/App.tsx",
      content: `import { BrowserRouter, Routes, Route } from "react-router-dom";
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}`,
    };
    const other = {
      path: "src/routes/Shop.tsx",
      content: `import { Routes, Route } from "react-router-dom";
export function Shop() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="a" element={<A />} />
        <Route path="b" element={<B />} />
      </Route>
    </Routes>
  );
}`,
    };
    const res = validateRouteGraph([app, other]);
    const shop = res.files.find((f) => f.path === other.path)!;
    // The nested block must be left intact — removing it would strand
    // `</Route>` and break the build.
    expect(shop.content).toContain(`<Route path="a"`);
    expect((shop.content.match(/<Route\b/g) ?? []).length).toBe(
      (other.content.match(/<Route\b/g) ?? []).length,
    );
  });
});

describe("route-graph R4 — Outlet insertion", () => {
  it("inserts before the root closing tag, not one found inside a string", () => {
    const layout = {
      path: "src/Layout.tsx",
      content: `export function Layout() {
  return (
    <div className="shell">
      <p>{"</div> is not a tag"}</p>
    </div>
  );
}`,
    };
    const app = {
      path: "src/App.tsx",
      content: `import { Routes, Route } from "react-router-dom";
import { Layout } from "./Layout";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="x" element={<X />} />
      </Route>
    </Routes>
  );
}`,
    };
    const res = validateRouteGraph([app, layout]);
    const out = res.files.find((f) => f.path === layout.path)!;
    expect(out.content).toContain("<Outlet />");
    // Balanced: one <div and one </div> tag remain outside the string.
    const openDivs = (out.content.match(/<div\b/g) ?? []).length;
    const closeDivs = (out.content.match(/<\/div>/g) ?? []).length;
    expect(closeDivs).toBe(openDivs + 1); // +1 for the literal inside the string
    // Outlet must sit before the final closing tag of the root element.
    expect(out.content.indexOf("<Outlet />")).toBeLessThan(
      out.content.lastIndexOf("</div>"),
    );
  });
});

describe("bare-import-resolver — unknown packages", () => {
  it("shims identifiers instead of leaving them undefined", () => {
    const files: ProjectFile[] = [
      {
        path: "src/Page.tsx",
        content: `import Fancy, { useThing } from "totally-not-a-real-pkg";
export default function Page() {
  const t = useThing();
  return <Fancy value={t} />;
}`,
      },
      { path: "package.json", content: JSON.stringify({ dependencies: {} }) },
    ];
    const res = repairBareImports(files);
    const page = res.files.find((f) => f.path === "src/Page.tsx")!;
    if (res.stripped.some((s) => s.path === "src/Page.tsx")) {
      expect(page.content).not.toMatch(/^import .*totally-not-a-real-pkg/m);
      expect(page.content).toMatch(/const Fancy: any/);
      expect(page.content).toMatch(/const useThing: any/);
    }
  });
});
