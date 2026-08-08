import { describe, expect, it } from "vitest";
import {
  checkFileBudgets,
  enforceFileBudgets,
  HARD_REJECT_BYTES,
} from "@/server/file-budget.server";

describe("file budget", () => {
  it("warns but preserves a complete 12 KB interactive page", () => {
    const content = `export default function Home(){return <main>${"healthy content ".repeat(800)}</main>}`;
    const next = [{ path: "src/pages/Home.tsx", content }];
    const verdict = checkFileBudgets(next, ["src/pages/Home.tsx"]);

    expect(new TextEncoder().encode(content).byteLength).toBeLessThan(HARD_REJECT_BYTES);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.rejections).toHaveLength(0);
  });

  it("reverts an existing hard-rejected file exactly once", () => {
    const prior = [{ path: "src/pages/Home.tsx", content: "export default function Home(){return null}" }];
    const oversized = "x".repeat(HARD_REJECT_BYTES + 1);
    const next = [{ path: "src/pages/Home.tsx", content: oversized }];
    const verdict = checkFileBudgets(next, ["src/pages/Home.tsx"]);
    const result = enforceFileBudgets(next, prior, verdict.rejections);

    expect(result).toEqual(prior);
  });
});