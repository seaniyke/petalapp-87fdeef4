import { it, expect } from "vitest";
import { validateRouteGraph } from "../src/server/route-graph.server";
it("dbg", () => {
  const app = { path: "src/App.tsx", content: `import { Routes, Route } from "react-router-dom";
import { Layout } from "./Layout";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route path="x" element={<X />} />
      </Route>
    </Routes>
  );
}` };
  const layout = { path: "src/Layout.tsx", content: `export function Layout() {
  return (
    <div className="shell">
      <p>{"</div> is not a tag"}</p>
    </div>
  );
}` };
  const r = validateRouteGraph([app, layout]);
  console.log(JSON.stringify({ notes: r.notes, lmo: r.layoutsMissingOutlet }, null, 2));
  expect(1).toBe(1);
});
