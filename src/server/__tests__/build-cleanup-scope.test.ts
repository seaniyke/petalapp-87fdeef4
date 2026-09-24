import { describe, expect, it, vi } from "vitest";
import { runScopedBuildCleanup } from "@/server/build-cleanup-scope.server";

const files = [
  { path: "src/pages/Home.tsx", content: "export default function Home(){return <main>© 2024 Home</main>}" },
  { path: "src/pages/About.tsx", content: "export default function About(){return <main>© 2024 About</main>}" },
  { path: "src/App.tsx", content: "export default function App(){return null}" },
  { path: "package.json", content: JSON.stringify({ dependencies: {} }) },
];

describe("first-build cleanup scope", () => {
  it("cleans only changed files and excludes untouched starter files", () => {
    const result = runScopedBuildCleanup(files, ["src/pages/Home.tsx"]);
    expect(result.scope).toEqual(["src/pages/Home.tsx"]);
    expect(result.files.find((f) => f.path === "src/pages/Home.tsx")?.content).toContain("© 2026");
    expect(result.files.find((f) => f.path === "src/pages/About.tsx")?.content).toContain("© 2024");
  });

  it("skips cleanup when no files changed", () => {
    const result = runScopedBuildCleanup(files, []);
    expect(result.skipped).toBe(true);
    expect(result.files).toBe(files);
  });

  it("includes a shared router only when it was legitimately changed", () => {
    const result = runScopedBuildCleanup(files, ["src/App.tsx"]);
    expect(result.scope).toEqual(["src/App.tsx"]);
    expect(result.modified).not.toContain("src/pages/About.tsx");
  });

  it("records exact scope without expanding to the project", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    runScopedBuildCleanup(files, ["src/pages/Home.tsx"], {
      turnId: "turn-1",
      attemptId: "attempt-1",
      unitId: "unit-1",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("turn=turn-1 attempt=attempt-1 unit=unit-1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cleanup=1"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('["src/pages/Home.tsx"]'));
    log.mockRestore();
  });
});