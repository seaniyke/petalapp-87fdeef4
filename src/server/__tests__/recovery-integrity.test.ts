import { describe, it, expect, vi } from "vitest";
import {
  classifyFailureOrigin,
  guidanceFor,
  InfrastructureFailure,
  isInfrastructureFailure,
  originFromReason,
  permitsDestructiveRecovery,
} from "@/lib/failure-classification";
import { blockedRemovals, structurallyCriticalPaths } from "@/server/engine/structural-deps";
import { recoverMissingPrimitives } from "@/server/engine/deterministic-primitives";
import { deriveActivityState } from "@/lib/turn-execution/activity-state";

const app = [
  { path: "index.html", content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
  { path: "src/main.tsx", content: 'import App from "./App";\nimport "./index.css";' },
  { path: "src/App.tsx", content: 'import Home from "./pages/Home";\nimport About from "./pages/About";\nimport { Nav } from "@/components/Nav";' },
  { path: "src/pages/Home.tsx", content: 'import { Nav } from "../components/Nav";\nexport default function Home(){return null}' },
  { path: "src/pages/About.tsx", content: "export default function About(){return null}" },
  { path: "src/components/Nav.tsx", content: "export function Nav(){return null}" },
];

describe("failure classification", () => {
  it("A: provider 502 during repair is infrastructure, never destructive", () => {
    const e = new InfrastructureFailure("repair provider returned HTTP 502", 502);
    expect(classifyFailureOrigin(e)).toBe("infrastructure");
    expect(classifyFailureOrigin("HTTP 502 Bad Gateway")).toBe("infrastructure");
    expect(classifyFailureOrigin({ status: 503 })).toBe("infrastructure");
    expect(permitsDestructiveRecovery("infrastructure")).toBe(false);
    expect(isInfrastructureFailure(e)).toBe(true);
  });
  it("separates transport, cancellation and code failures", () => {
    expect(classifyFailureOrigin("stream closed with no result payload")).toBe("transport");
    expect(classifyFailureOrigin(new Error("The operation was aborted"))).toBe("cancelled");
    expect(classifyFailureOrigin("ReferenceError: mode is not defined")).toBe("code");
    expect(classifyFailureOrigin("Could not resolve ./hooks/usePageMeta")).toBe("code");
    expect(permitsDestructiveRecovery("transport")).toBe(false);
    expect(permitsDestructiveRecovery("code")).toBe(true);
  });
  it("O: each failure gets the right semantic next action", () => {
    expect(guidanceFor("infrastructure").action).toBe("continue");
    expect(guidanceFor("code").action).toBe("fix");
    expect(guidanceFor("transport").action).toBeNull();
    expect(guidanceFor("cancelled").action).toBeNull();
    expect(guidanceFor("user_input").userMustAct).toBe(true);
    expect(originFromReason("infrastructure:provider_unavailable")).toBe("infrastructure");
  });
});

describe("dependency-aware removal", () => {
  it("H: entry, shell and shared modules are critical; leaf pages are not", () => {
    const c = structurallyCriticalPaths(app, app.map((f) => f.path));
    expect(c.has("src/main.tsx")).toBe(true);
    expect(c.has("src/App.tsx")).toBe(true);
    expect(c.has("src/components/Nav.tsx")).toBe(true);
    expect(c.has("src/pages/About.tsx")).toBe(false);
  });
  it("H: blocks removing the shell without a validated replacement", () => {
    expect(blockedRemovals(app, ["src/App.tsx"], () => false)).toEqual(["src/App.tsx"]);
    expect(blockedRemovals(app, ["src/App.tsx"], (p) => p === "src/App.tsx")).toEqual([]);
    expect(blockedRemovals(app, ["src/pages/About.tsx"], () => false)).toEqual([]);
  });
});

describe("deterministic primitives", () => {
  it("J: allowlisted generic primitive is provided", () => {
    const files = [...app, { path: "src/pages/X.tsx", content: 'import { cn } from "@/lib/utils";' }];
    const r = recoverMissingPrimitives(files);
    expect(r.added).toEqual(["src/lib/utils.ts"]);
    expect(r.files.find((f) => f.path === "src/lib/utils.ts")!.content).toContain("twMerge");
  });
  it("I: project-specific hook is never stubbed", () => {
    const files = [...app, { path: "src/pages/Y.tsx", content: 'import { usePageMeta } from "../hooks/usePageMeta";' }];
    const r = recoverMissingPrimitives(files);
    expect(r.added).toEqual([]);
    expect(r.unresolved).toContain("src/hooks/usePageMeta");
  });
  it("fabrication guard: allowlisted path asked for a name it doesn't export is not faked", () => {
    const files = [...app, { path: "src/pages/Z.tsx", content: 'import { cn, formatMoney } from "@/lib/utils";' }];
    const r = recoverMissingPrimitives(files);
    expect(r.added).toEqual([]);
  });
});

describe("single activity interpretation", () => {
  const latched = { busy: true, isDeploying: true, awaitingBuild: true, awaitingSilentResume: true };
  it("E/F/G: terminal lifecycles stop the spinner whatever flags remain", () => {
    for (const lc of ["failed", "cancelled", "ready", "build_failed", "verify_failed"]) {
      expect(deriveActivityState(lc, latched).active).toBe(false);
    }
  });
  it("success shows only for a successful terminal state", () => {
    expect(deriveActivityState("ready", {}, true).complete).toBe(true);
    expect(deriveActivityState("failed", {}, true).complete).toBe(false);
    expect(deriveActivityState("building", { awaitingBuild: true }, true)).toEqual({ active: true, complete: false });
  });
  it("N: stopping stays active until the cancellation is terminal", () => {
    expect(deriveActivityState("stopping", {}).active).toBe(true);
    expect(deriveActivityState("cancelled", { busy: true }).active).toBe(false);
  });
  it("P: evaluation is idempotent", () => {
    expect(deriveActivityState("failed", latched)).toEqual(deriveActivityState("failed", latched));
  });
});

describe("repairBrokenFile infrastructure signalling", () => {
  it("A: throws InfrastructureFailure on provider 502 instead of returning 'no fix'", async () => {
    vi.resetModules();
    vi.doMock("@/server/ai-provider.server", () => ({
      aiChatCompletions: async () => new Response("bad gateway", { status: 502 }),
    }));
    const { repairBrokenFile } = await import("@/server/engine/repair");
    await expect(repairBrokenFile({ path: "src/App.tsx", content: "x" }, "missing import")).rejects.toMatchObject({ origin: "infrastructure" });
    vi.doUnmock("@/server/ai-provider.server");
  });
});
