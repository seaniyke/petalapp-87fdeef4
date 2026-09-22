import { describe, it, expect } from "vitest";
import { fixMissingRouterProvider, stripStrayJsxCommas } from "../router-provider.server";

const entryWithTrailingComma = `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;

const appUsingRouter = `import { Routes, Route } from "react-router-dom";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<div />} />
    </Routes>
  );
}
`;

describe("router provider injection", () => {
  it("never sweeps the render trailing comma into JSX", () => {
    const out = fixMissingRouterProvider([
      { path: "src/main.tsx", content: entryWithTrailingComma },
      { path: "src/App.tsx", content: appUsingRouter },
    ] as any);
    const main = out.files.find((f) => f.path === "src/main.tsx")!.content;
    expect(main).toContain("<BrowserRouter>");
    expect(main).not.toMatch(/<\/React\.StrictMode>\s*,\s*\n\s*<\//);
    expect(main).not.toMatch(/<\/BrowserRouter>\s*,/);
  });

  it("heals an entry that already renders a stray comma", () => {
    const broken = `render(<BrowserRouter>
    <React.StrictMode>
      <App />
  </React.StrictMode>,
  </BrowserRouter>);`;
    expect(stripStrayJsxCommas(broken)).not.toMatch(/>\s*,\s*\n/);
  });
});
