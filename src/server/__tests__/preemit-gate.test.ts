/**
 * Kimble v3 Phase A — pre-emit gate contract tests.
 *
 * These lock the properties that make the gate safe to run on every turn:
 * it must not block on things nobody can fix, it must never hand back a
 * worse file set than it received, and it must stop instead of spinning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/esbuild-verifier.server", () => ({
  verifyFilesEsbuild: vi.fn(),
}));
vi.mock("@/server/local-verifier", () => ({
  verifyFilesLocal: vi.fn(),
}));
vi.mock("@/server/render-risk-linter", () => ({
  lintRenderRisks: vi.fn(),
}));

import {
  runPreEmitGate,
  collectGateIssues,
  isBlocking,
  isScaffoldOwned,
  formatGateIssues,
} from "../preemit-gate.server";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { verifyFilesLocal } from "@/server/local-verifier";
import { lintRenderRisks } from "@/server/render-risk-linter";

const files = [{ path: "src/App.tsx", content: "export default function App(){return null}" }];
const changed = ["src/App.tsx"];

function setVerifiers(opts: {
  esbuild?: { path: string; line: number; column: number; message: string }[];
  local?: { path: string; kind: string; detail: string }[];
  render?: { path: string; kind: string; detail: string }[];
  esbuildCheckedPaths?: string[];
}) {
  vi.mocked(verifyFilesEsbuild).mockResolvedValue({
    status: (opts.esbuild ?? []).length === 0 ? "passed" : "failed",
    ok: (opts.esbuild ?? []).length === 0,
    issues: (opts.esbuild ?? []).map((i) => ({ ...i, kind: "parse" as const })),
    // Default: no parser verdict, so heuristic syntax issues stay blocking.
    checkedPaths: opts.esbuildCheckedPaths ?? [],
  });
  vi.mocked(verifyFilesLocal).mockReturnValue({
    ok: (opts.local ?? []).length === 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    issues: (opts.local ?? []) as any,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(lintRenderRisks).mockReturnValue((opts.render ?? []) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("severity classification", () => {
  it("treats every esbuild parse failure as blocking", () => {
    expect(
      isBlocking({ path: "src/App.tsx", kind: "parse", detail: "x", source: "esbuild" }),
    ).toBe(true);
  });

  it("treats render risks as advisory, not blocking", () => {
    expect(
      isBlocking({
        path: "src/App.tsx",
        kind: "render-risk",
        detail: "optional prop",
        source: "render-risk",
      }),
    ).toBe(false);
  });

  it("never blocks on scaffold-owned files, even for a parse error", () => {
    expect(
      isBlocking({
        path: "src/components/ui/button.tsx",
        kind: "parse",
        detail: "x",
        source: "esbuild",
      }),
    ).toBe(false);
  });

  it("recognises the scaffold-owned paths", () => {
    expect(isScaffoldOwned("vite.config.ts")).toBe(true);
    expect(isScaffoldOwned("src/components/ui/card.tsx")).toBe(true);
    expect(isScaffoldOwned("src/integrations/backend/client.ts")).toBe(true);
    expect(isScaffoldOwned("src/App.tsx")).toBe(false);
  });
});

describe("issue collection", () => {
  it("merges all three verifiers and dedupes identical findings", async () => {
    setVerifiers({
      esbuild: [{ path: "src/App.tsx", line: 1, column: 2, message: "Unexpected }" }],
      local: [{ path: "src/App.tsx", kind: "braces", detail: "unbalanced" }],
      render: [{ path: "src/App.tsx", kind: "render-risk", detail: "optional prop" }],
    });
    const issues = await collectGateIssues(files, changed);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.source).sort()).toEqual(["esbuild", "local", "render-risk"]);
  });

  it("turns an unexpected parser error into a blocking infrastructure state", async () => {
    setVerifiers({ local: [{ path: "src/App.tsx", kind: "braces", detail: "unbalanced" }] });
    vi.mocked(verifyFilesEsbuild).mockRejectedValue(new Error("wasm init failed"));
    const issues = await collectGateIssues(files, changed);
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.kind === "validator-unavailable" && i.source === "esbuild")).toBe(true);
    expect(issues.some((i) => i.source === "local")).toBe(true);
  });
});

describe("verifier only", () => {
  it("never repairs: blocking issues are reported, files returned unchanged", async () => {
    setVerifiers({ esbuild: [{ path: "src/App.tsx", line: 1, column: 1, message: "Unexpected }" }] });
    const { files: out, report } = await runPreEmitGate(files, changed, { maxRounds: 2 });
    expect(out).toBe(files);
    expect(report.ok).toBe(false);
    expect(report.rounds).toBe(0);
  });
  it("passes when nothing blocks", async () => {
    setVerifiers({});
    const { report } = await runPreEmitGate(files, changed);
    expect(report.ok).toBe(true);
  });
});

describe("reporting", () => {
  it("formats issues compactly and respects the limit", () => {
    const text = formatGateIssues(
      [
        { path: "a.tsx", kind: "parse", detail: "one", source: "esbuild" },
        { path: "b.tsx", kind: "jsx", detail: "two", source: "local" },
      ],
      1,
    );
    expect(text).toBe("a.tsx (parse): one");
  });
});

describe("parser beats heuristics", () => {
  it("ignores a heuristic JSX imbalance when esbuild parsed the file cleanly", async () => {
    setVerifiers({
      esbuildCheckedPaths: ["src/App.tsx"],
      local: [{ path: "src/App.tsx", kind: "jsx", detail: "<Sidebar>: 7 open vs 1 close" }],
    });
    const issues = await collectGateIssues(files, changed);
    expect(issues).toHaveLength(0);
  });

  it("still blocks when esbuild did not check the file", async () => {
    setVerifiers({
      local: [{ path: "src/App.tsx", kind: "jsx", detail: "<Sidebar>: 7 open vs 1 close" }],
    });
    const issues = await collectGateIssues(files, changed);
    expect(issues).toHaveLength(1);
  });

  it("reports parser unavailability explicitly instead of a clean verdict", async () => {
    setVerifiers({});
    vi.mocked(verifyFilesEsbuild).mockResolvedValue({
      status: "unavailable",
      ok: false,
      issues: [],
      checkedPaths: [],
      unavailableReason: "initialization_error",
      unavailableDetail: "runtime missing",
    });
    const { report } = await runPreEmitGate(files, changed);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "validator-unavailable", source: "esbuild" }),
    ]));
  });
});
