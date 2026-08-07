import { describe, expect, it } from "vitest";
import {
  ensureRenderableShell,
  isMissingRootView,
} from "../renderable-shell.server";

describe("renderable shell root-view detection", () => {
  it("keeps a complete app with a nested return-null guard", () => {
    const app = `
function Results({ value }: { value?: number }) {
  if (!value) return null;
  return <output>{value}</output>;
}

export default function App() {
  return <main><h1>Pregnancy calculator</h1><Results /></main>;
}
`;
    const result = ensureRenderableShell([{ path: "src/App.tsx", content: app }]);

    expect(isMissingRootView(app)).toBe(false);
    expect(result.fixed).not.toContain("src/App.tsx");
    expect(result.degraded).toEqual([]);
    expect(result.files.find((file) => file.path === "src/App.tsx")?.content).toBe(app);
  });

  it("keeps a complete app with a nested empty-fragment branch", () => {
    const app = `
function OptionalNote({ show }: { show: boolean }) {
  if (!show) return <></>;
  return <p>Estimate ready</p>;
}
export default function App() {
  return <main><OptionalNote show={false} /></main>;
}
`;
    expect(isMissingRootView(app)).toBe(false);
  });

  it("does not treat placeholder-like prose in a real app as an empty root", () => {
    const app = `export default function App() {
  const note = "REPLACE this date when your cycle changes";
  return <main>{note}</main>;
}`;
    expect(isMissingRootView(app)).toBe(false);
  });

  it("still replaces a genuinely empty root view", () => {
    const result = ensureRenderableShell([{ path: "src/App.tsx", content: "  \n" }]);
    expect(result.fixed).toContain("src/App.tsx");
    expect(result.degraded).toContain("src/App.tsx");
  });

  it("still replaces an app that only returns null", () => {
    const app = "export default function App() { return null; }";
    expect(isMissingRootView(app)).toBe(true);
  });
});