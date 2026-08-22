import { describe, it, expect } from "vitest";
import {
  findMissingComposition,
  findCompositionIssues,
  COMPOSITION_CONTRACT_BLOCK,
} from "@/server/composition-contract.server";

const flat = `export default function Categories() {
  return (
    <div>
      <h1>Categories</h1>
      <p>Manage your categories.</p>
      <ul>
${Array.from({ length: 20 }, (_, i) => `        <li>Item ${i}</li>`).join("\n")}
      </ul>
    </div>
  );
}
`;

const composed = `export default function Categories() {
  return (
    <section className="py-16 md:py-24">
      <h1 className="text-4xl md:text-6xl tracking-tight font-bold">Categories</h1>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
${Array.from({ length: 20 }, (_, i) => `        <div className="rounded-2xl border bg-card p-6 shadow-sm">Item ${i}</div>`).join("\n")}
      </div>
    </section>
  );
}
`;

describe("composition contract", () => {
  it("flags a flat placeholder screen", () => {
    expect(findMissingComposition(flat).length).toBeGreaterThanOrEqual(3);
    const issues = findCompositionIssues([{ path: "src/pages/Categories.tsx", content: flat } as never]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.detail).toMatch(/composition-contract/);
  });

  it("passes a composed screen", () => {
    expect(findMissingComposition(composed)).toEqual([]);
    expect(findCompositionIssues([{ path: "src/pages/Categories.tsx", content: composed } as never])).toEqual([]);
  });

  it("ignores non-screen files", () => {
    expect(findCompositionIssues([{ path: "src/lib/utils.ts", content: flat } as never])).toEqual([]);
  });

  it("states the landing requirements in the prompt block", () => {
    expect(COMPOSITION_CONTRACT_BLOCK).toMatch(/feature grid/i);
    expect(COMPOSITION_CONTRACT_BLOCK).toMatch(/pricing/i);
    expect(COMPOSITION_CONTRACT_BLOCK).toMatch(/call to action/i);
  });
});
