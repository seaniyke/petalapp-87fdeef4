/**
 * Phase B/C contract tests.
 *
 * These lock in the two properties that make the write gate safe to leave on:
 * a broken file never reaches the project, and a rejection never leaves the
 * project worse than it started.
 */
import { describe, it, expect } from "vitest";
import { runWriteGate, writeGateDisclosure } from "@/server/write-gate.server";
import {
  isScaffoldOwnedPath,
  isVerifierExempt,
} from "@/server/scaffold-ownership.server";

const GOOD = `export default function App() {\n  return <div>hi</div>;\n}\n`;
const BROKEN = `export default function App() {\n  return <div>hi</div>\n`;
const FENCED = "```tsx\nexport const A = () => <p>a</p>;\n```\n";

describe("scaffold ownership", () => {
  it("protects the UI kit and build config from model writes", () => {
    expect(isScaffoldOwnedPath("src/components/ui/button.tsx")).toBe(true);
    expect(isScaffoldOwnedPath("vite.config.ts")).toBe(true);
    expect(isScaffoldOwnedPath("package.json")).toBe(true);
    expect(isScaffoldOwnedPath("src/pages/Home.tsx")).toBe(false);
  });

  it("exempts more from verifier blocking than it forbids writing", () => {
    expect(isVerifierExempt("src/integrations/supabase/client.ts")).toBe(true);
    expect(isScaffoldOwnedPath("src/integrations/supabase/client.ts")).toBe(false);
    expect(isVerifierExempt("index.html")).toBe(true);
  });
});

describe("write gate", () => {
  it("passes clean writes through untouched", async () => {
    const after = [{ path: "src/App.tsx", content: GOOD }];
    const res = await runWriteGate({ before: [], after, changedPaths: ["src/App.tsx"] });
    expect(res.rejected).toEqual([]);
    expect(res.files).toEqual(after);
  });

  it("heals a leaked markdown fence instead of rejecting", async () => {
    const res = await runWriteGate({
      before: [],
      after: [{ path: "src/A.tsx", content: FENCED }],
      changedPaths: ["src/A.tsx"],
    });
    expect(res.rejected).toEqual([]);
    expect(res.healedPaths).toContain("src/A.tsx");
    expect(res.files[0].content).not.toContain("```");
  });

  it("reverts an unparseable edit to the previous bytes", async () => {
    const before = [{ path: "src/App.tsx", content: GOOD }];
    const res = await runWriteGate({
      before,
      after: [{ path: "src/App.tsx", content: BROKEN }],
      changedPaths: ["src/App.tsx"],
    });
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reverted).toBe(true);
    expect(res.files.find((f) => f.path === "src/App.tsx")?.content).toBe(GOOD);
  });

  it("drops an unparseable new file rather than shipping it", async () => {
    const res = await runWriteGate({
      before: [],
      after: [{ path: "src/New.tsx", content: BROKEN }],
      changedPaths: ["src/New.tsx"],
    });
    expect(res.rejected[0].reverted).toBe(false);
    expect(res.files.some((f) => f.path === "src/New.tsx")).toBe(false);
  });

  it("never blocks on scaffold-owned paths", async () => {
    const after = [{ path: "src/components/ui/button.tsx", content: BROKEN }];
    const res = await runWriteGate({
      before: [],
      after,
      changedPaths: ["src/components/ui/button.tsx"],
    });
    expect(res.rejected).toEqual([]);
  });

  it("keeps unrelated good files when one write is refused", async () => {
    const before = [{ path: "src/App.tsx", content: GOOD }];
    const res = await runWriteGate({
      before,
      after: [
        { path: "src/App.tsx", content: BROKEN },
        { path: "src/Ok.tsx", content: GOOD },
      ],
      changedPaths: ["src/App.tsx", "src/Ok.tsx"],
    });
    expect(res.files.find((f) => f.path === "src/Ok.tsx")?.content).toBe(GOOD);
    expect(res.files.find((f) => f.path === "src/App.tsx")?.content).toBe(GOOD);
  });

  it("says nothing when nothing was rejected", () => {
    expect(writeGateDisclosure([])).toBe("");
    expect(
      writeGateDisclosure([{ path: "src/A.tsx", detail: "boom", reverted: true }]),
    ).toContain("src/A.tsx");
  });
});
