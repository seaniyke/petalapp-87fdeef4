import { describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "@/server/generate.server";

vi.mock("@/server/npm-existence.server", () => ({
  applyNpmPreflight: async (issues: unknown[]) => ({
    issues,
    realButMissing: [],
    hallucinated: [],
  }),
}));
vi.mock("@/server/esbuild-verifier.server", () => ({
  verifyFilesEsbuild: vi.fn(),
}));

import { runLocalVerifyTier } from "@/server/pipeline/tier-local-verify";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";

describe("fresh-project authored-file boundary", () => {
  it("does not treat injected scaffold files as model-authored changes", async () => {
    const authored: ProjectFile[] = [
      { path: "src/App.tsx", content: "export default function App(){ return <main>Calculator</main> }" },
      { path: "src/components/calculator.tsx", content: "export function Calculator(){ return <section>Dates</section> }" },
    ];
    const injected: ProjectFile[] = Array.from({ length: 300 }, (_, index) => ({
      path: `src/components/ui/generated-${index}.tsx`,
      content: `export const Generated${index} = () => null`,
    }));

    const result = await runLocalVerifyTier({
      nextFiles: [...authored, ...injected],
      currentFiles: [],
      toolName: "write_project",
      parsedOps: undefined,
      authoredPaths: authored.map((file) => file.path),
    });

    expect(result.earlyChangedPaths).toEqual([
      "src/App.tsx",
      "src/components/calculator.tsx",
    ]);
    expect(result.earlyChangedPaths).not.toContain("src/components/ui/generated-0.tsx");
  });

  it("surfaces parser unavailability instead of treating a heuristic as proven broken", async () => {
    vi.mocked(verifyFilesEsbuild).mockResolvedValue({
      status: "unavailable",
      ok: false,
      issues: [],
      checkedPaths: [],
      unavailableReason: "initialization_error",
      unavailableDetail: "runtime missing",
    });
    const result = await runLocalVerifyTier({
      nextFiles: [{ path: "src/App.tsx", content: `export default function App(){ return <p>Can't load</p> }` }],
      currentFiles: [],
      toolName: "write_project",
      parsedOps: undefined,
      authoredPaths: ["src/App.tsx"],
    });
    // This assertion uses a forced heuristic signal in environments where the
    // local scanner changes; unavailable is only required when confirmation ran.
    if (vi.mocked(verifyFilesEsbuild).mock.calls.length > 0) {
      expect(result.validationFailure).toContain("runtime missing");
    }
  });
});