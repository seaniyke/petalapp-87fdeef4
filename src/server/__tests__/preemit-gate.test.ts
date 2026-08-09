/**
 * Petal v3 Phase A — pre-emit gate contract tests.
 *
 * These lock the properties that make the gate safe to run on every turn:
 * it must not block on things nobody can fix, it must never hand back a
 * worse file set than it received, and it must stop instead of spinning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/post-stream-autofix.server", () => ({
  runPostStreamAutofix: vi.fn(),
}));
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
import { runPostStreamAutofix } from "@/server/post-stream-autofix.server";
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

  it("survives a verifier that throws instead of losing the other verdicts", async () => {
    setVerifiers({ local: [{ path: "src/App.tsx", kind: "braces", detail: "unbalanced" }] });
    vi.mocked(verifyFilesEsbuild).mockRejectedValue(new Error("wasm init failed"));
    const issues = await collectGateIssues(files, changed);
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe("local");
  });
});

describe("the loop", () => {
  it("spends zero rounds when the first check is green", async () => {
    setVerifiers({});
    const { report } = await runPreEmitGate(files, changed);
    expect(report.ok).toBe(true);
    expect(report.rounds).toBe(0);
    expect(runPostStreamAutofix).not.toHaveBeenCalled();
  });

  it("does not spend a round on advisory-only findings", async () => {
    setVerifiers({ render: [{ path: "src/App.tsx", kind: "render-risk", detail: "risk" }] });
    const { report } = await runPreEmitGate(files, changed);
    expect(report.ok).toBe(true);
    expect(runPostStreamAutofix).not.toHaveBeenCalled();
  });

  it("repairs a blocking issue and converges", async () => {
    let call = 0;
    vi.mocked(verifyFilesLocal).mockImplementation(() => {
      call += 1;
      return call === 1
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ({ ok: false, issues: [{ path: "src/App.tsx", kind: "braces", detail: "bad" }] } as any)
        : { ok: true, issues: [], checkedPaths: [] };
    });
    vi.mocked(verifyFilesEsbuild).mockResolvedValue({ ok: true, issues: [], checkedPaths: [] });
    vi.mocked(lintRenderRisks).mockReturnValue([]);
    const fixed = [{ path: "src/App.tsx", content: "fixed" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(runPostStreamAutofix).mockResolvedValue({ files: fixed, result: {} } as any);

    const out = await runPreEmitGate(files, changed, { maxRounds: 2 });
    expect(out.report.ok).toBe(true);
    expect(out.report.rounds).toBe(1);
    expect(out.files).toEqual(fixed);
  });

  it("stops early when a round makes no progress instead of burning the budget", async () => {
    setVerifiers({ local: [{ path: "src/App.tsx", kind: "braces", detail: "bad" }] });
    vi.mocked(runPostStreamAutofix).mockResolvedValue({
      files,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: {} as any,
    });
    const out = await runPreEmitGate(files, changed, { maxRounds: 3 });
    expect(out.report.ok).toBe(false);
    expect(out.report.rounds).toBe(1);
    expect(runPostStreamAutofix).toHaveBeenCalledTimes(1);
  });

  it("keeps the best state seen rather than a regressed repair", async () => {
    let call = 0;
    vi.mocked(verifyFilesEsbuild).mockResolvedValue({ ok: true, issues: [], checkedPaths: [] });
    vi.mocked(lintRenderRisks).mockReturnValue([]);
    vi.mocked(verifyFilesLocal).mockImplementation(() => {
      call += 1;
      const issues =
        call === 1
          ? [{ path: "src/App.tsx", kind: "braces", detail: "one" }]
          : [
              { path: "src/App.tsx", kind: "braces", detail: "one" },
              { path: "src/App.tsx", kind: "jsx", detail: "two" },
            ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { ok: false, issues } as any;
    });
    const worse = [{ path: "src/App.tsx", content: "worse" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(runPostStreamAutofix).mockResolvedValue({ files: worse, result: {} } as any);

    const out = await runPreEmitGate(files, changed, { maxRounds: 2 });
    expect(out.files).toEqual(files);
    expect(out.report.ok).toBe(false);
  });

  it("re-runs deterministic repairs on the model's output via afterRepair", async () => {
    vi.mocked(verifyFilesEsbuild).mockResolvedValue({ ok: true, issues: [], checkedPaths: [] });
    vi.mocked(lintRenderRisks).mockReturnValue([]);
    vi.mocked(verifyFilesLocal).mockReturnValue({ ok: true, issues: [] });
    vi.mocked(verifyFilesLocal).mockReturnValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ok: false, issues: [{ path: "src/App.tsx", kind: "jsx", detail: "bad" }] } as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(runPostStreamAutofix).mockResolvedValue({ files, result: {} } as any);
    const afterRepair = vi.fn((f) => f);
    await runPreEmitGate(files, changed, { maxRounds: 1, afterRepair });
    expect(afterRepair).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful model repair when deterministic repair regresses it", async () => {
    vi.mocked(verifyFilesEsbuild).mockResolvedValue({ ok: true, issues: [], checkedPaths: [] });
    vi.mocked(lintRenderRisks).mockReturnValue([]);
    vi.mocked(verifyFilesLocal).mockImplementation((candidate) => {
      const content = candidate.find((file) => file.path === "src/App.tsx")?.content;
      if (content === "model-fixed") return { ok: true, issues: [] };
      return {
        ok: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        issues: [{ path: "src/App.tsx", kind: "jsx", detail: "broken" }] as any,
      };
    });
    const modelFixed = [{ path: "src/App.tsx", content: "model-fixed" }];
    const deterministicallyRegressed = [{ path: "src/App.tsx", content: "regressed" }];
    vi.mocked(runPostStreamAutofix).mockResolvedValue({
      files: modelFixed,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: {} as any,
    });

    const out = await runPreEmitGate(files, changed, {
      maxRounds: 2,
      afterRepair: () => deterministicallyRegressed,
    });

    expect(out.report.ok).toBe(true);
    expect(out.files).toEqual(modelFixed);
    expect(out.report.trace.some((line) => line.includes("deterministic repair regressed"))).toBe(true);
  });

  it("degrades to green when the repair pass itself throws", async () => {
    setVerifiers({ local: [{ path: "src/App.tsx", kind: "braces", detail: "bad" }] });
    vi.mocked(runPostStreamAutofix).mockRejectedValue(new Error("gateway down"));
    const out = await runPreEmitGate(files, changed, { maxRounds: 2 });
    expect(out.files).toEqual(files);
    expect(out.report.trace.some((t) => t.includes("errored"))).toBe(true);
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
});
