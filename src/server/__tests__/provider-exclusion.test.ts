import { describe, it, expect } from "vitest";
import { CODEGEN_PROVIDER_ORDER } from "@/lib/ai-model-config";
import { codegenProviderRouting } from "@/server/ai-provider.server";
import {
  runWithTurnContext,
  markUpstreamFailed,
  failedUpstreamsForTurn,
  type TurnContext,
} from "@/server/turn-context.server";
import { assessRouteCoverage, mergeChunk } from "@/server/chunked-generation.server";
import { EMPTY_HOME_BUILD_FAILURE_MESSAGE, PROMPT_BLAME_PATTERN } from "@/server/build-failure-copy";

describe("page-writing provider routing", () => {
  it("DeepInfra is not primary for page generation", () => {
    expect(CODEGEN_PROVIDER_ORDER[0]).not.toBe("deepinfra");
    expect((codegenProviderRouting().order as string[])[0]).not.toBe("deepinfra");
  });
});

describe("per-turn failed-provider exclusion", () => {
  it("a failed upstream is excluded for every later call in the turn (continuation/recovery/repair)", async () => {
    const ctx: TurnContext = { turnId: "t1" };
    await runWithTurnContext(ctx, async () => {
      markUpstreamFailed("DeepInfra");
      const avoid = failedUpstreamsForTurn();
      expect(avoid).toEqual(["deepinfra"]);
      // Every codegen call (retry, continuation, missing-page, repair) routes through this.
      const r = codegenProviderRouting(avoid);
      expect(r.order).not.toContain("deepinfra");
      expect(r.ignore).toContain("deepinfra");
    });
  });
  it("a fresh turn starts with no exclusions", async () => {
    await runWithTurnContext({ turnId: "t2" }, async () => {
      expect(failedUpstreamsForTurn()).toEqual([]);
    });
  });
});

describe("normal finish is not successful generation", () => {
  it("theme+brand only is incomplete for a first build", () => {
    const a = assessRouteCoverage({
      expectedRoutes: ["/menu", "/about", "/contact"],
      files: [
        { path: "src/index.css", content: "" },
        { path: "src/lib/brand.ts", content: "" },
      ],
      requireAppShell: true,
    });
    expect(a.needed).toBe(true);
    expect(a.remainingSteps[0]).toMatch(/src\/App\.tsx/);
    expect(a.remainingSteps.join(" ")).toMatch(/menu/);
    expect(a.deliveredPaths).toEqual(["src/index.css", "src/lib/brand.ts"]);
  });
  it("complete unit passes", () => {
    const a = assessRouteCoverage({
      expectedRoutes: ["/menu"],
      files: [
        { path: "src/App.tsx", content: '<Route path="/menu" />' },
        { path: "src/pages/Menu.tsx", content: "" },
      ],
      routerSource: '<Route path="/menu" />',
      requireAppShell: true,
    });
    expect(a.needed).toBe(false);
  });
  it("completed pages are preserved; missing scope is added", () => {
    const base = { ops: [], files: [{ path: "src/pages/Menu.tsx", content: "done" }] };
    const m = mergeChunk(base, {
      files: [
        { path: "src/pages/Menu.tsx", content: "regen" },
        { path: "src/pages/About.tsx", content: "new" },
      ],
    });
    expect(m.files.find((f) => f.path === "src/pages/Menu.tsx")!.content).toBe("done");
    expect(m.files.some((f) => f.path === "src/pages/About.tsx")).toBe(true);
  });
});

describe("build failure copy", () => {
  it("never blames the prompt", () => {
    expect(PROMPT_BLAME_PATTERN.test(EMPTY_HOME_BUILD_FAILURE_MESSAGE)).toBe(false);
    expect(EMPTY_HOME_BUILD_FAILURE_MESSAGE).toMatch(/build didn't finish/i);
  });
});
