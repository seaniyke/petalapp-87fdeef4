import { describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "@/server/generate.server";

vi.mock("@/server/npm-existence.server", () => ({
  applyNpmPreflight: async (issues: unknown[]) => ({
    issues,
    realButMissing: [],
    hallucinated: [],
  }),
}));

import { runLocalVerifyTier } from "@/server/pipeline/tier-local-verify";

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
});