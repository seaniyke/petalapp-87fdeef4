/**
 * Regression for the real hospital incident (turn 4f2e3bba…):
 * valid app → verification finds a missing project hook → repair → provider
 * 502 during repair → App.tsx was quarantined, main.tsx broke, spinner latched.
 * Every step below runs the production function that owns that decision.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyFailureOrigin, permitsDestructiveRecovery } from "@/lib/failure-classification";
import { blockedRemovals } from "@/server/engine/structural-deps";
import { recoverMissingPrimitives } from "@/server/engine/deterministic-primitives";
import { deriveActivityState } from "@/lib/turn-execution/activity-state";
import { isUnbillableTurn } from "@/lib/build-outcome";
import { PipelineError, toFriendlyError } from "@/lib/friendly-errors";

const lastValid = [
  { path: "index.html", content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
  { path: "src/main.tsx", content: 'import App from "./App";\nimport "./index.css";' },
  { path: "src/index.css", content: "body{}" },
  {
    path: "src/App.tsx",
    content: 'import Home from "./pages/Home";\nimport { usePageMeta } from "./hooks/usePageMeta";\nexport default function App(){usePageMeta("x");return null}',
  },
  {
    path: "src/pages/Home.tsx",
    content: 'import { usePageMeta } from "../hooks/usePageMeta";\nexport default function Home(){usePageMeta("Home");return null}',
  },
];
const snapshot = JSON.stringify(lastValid);

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/server/ai-provider.server");
});

async function repairWith(provider: () => Promise<Response>) {
  vi.resetModules();
  vi.doMock("@/server/ai-provider.server", () => ({ aiChatCompletions: provider }));
  const { repairBrokenFile } = await import("@/server/engine/repair");
  return repairBrokenFile(lastValid[3], 'Could not resolve "./hooks/usePageMeta"');
}

describe("hospital incident regression", () => {
  it("1–3: verification finds a genuine missing project hook that is never fabricated", () => {
    const r = recoverMissingPrimitives(lastValid);
    // usePageMeta is project behaviour, not a primitive — never stubbed.
    expect(r.files.find((f) => f.path.includes("usePageMeta"))).toBeUndefined();
    expect(classifyFailureOrigin('Could not resolve "./hooks/usePageMeta"')).toBe("code");
  });

  it.each([
    ["502", async () => new Response("bad gateway", { status: 502 })],
    ["timeout", async () => new Response("gateway timeout", { status: 504 })],
    ["network", async () => { throw new Error("fetch failed: ECONNRESET"); }],
  ])("4–7: repair provider %s is classified as an AI outage and stops", async (_n, provider) => {
    const err = await repairWith(provider as () => Promise<Response>).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(classifyFailureOrigin(err)).toBe("infrastructure");
    expect(permitsDestructiveRecovery(classifyFailureOrigin(err))).toBe(false);
  });

  it("8–9, 12: no valid file is quarantined or deleted; last valid state intact", () => {
    // Even if a later path proposes dropping the shell, the dependency guard refuses.
    const blocked = blockedRemovals(lastValid, ["src/App.tsx", "src/main.tsx"], () => false);
    expect(blocked.sort()).toEqual(["src/App.tsx", "src/main.tsx"]);
    const kept = lastValid.filter((f) => !["src/App.tsx", "src/main.tsx"].includes(f.path) || blocked.includes(f.path));
    expect(JSON.stringify(kept)).toBe(snapshot);
  });

  it("10–11: a rolled-back repair commits nothing and is never billed", () => {
    expect(
      isUnbillableTurn({ changedPathCount: 0, unappliedPathCount: 1, txCommitted: false, outcomeStatus: "rolled_back", outcomeReason: "verification_failed" }),
    ).toBe(true);
    expect(
      isUnbillableTurn({ changedPathCount: 2, unappliedPathCount: 0, txCommitted: false, outcomeStatus: "rolled_back", outcomeReason: "infrastructure:provider_unavailable" }),
    ).toBe(true);
    // Control: a committed success is billable (exactly once — settlement is idempotent on turn id).
    expect(
      isUnbillableTurn({ changedPathCount: 2, unappliedPathCount: 0, txCommitted: true, outcomeStatus: "committed" }),
    ).toBe(false);
  });

  it("13: UI reaches a terminal, non-spinning state even with local flags still set", () => {
    const s = deriveActivityState("failed", { busy: true, awaitingBuild: true, isDeploying: true }, true);
    expect(s).toEqual({ active: false, complete: false });
  });

  it("14: the user gets a safe Continue, told nothing changed", () => {
    const card = toFriendlyError(new PipelineError("x", "upstream_unavailable", "HTTP 502"));
    expect(card.origin).toBe("infrastructure");
    expect(card.actionKind).toBe("retry");
    expect(card.actionLabel).toBe("Continue");
    expect(card.projectChanged).toBe(false);
    expect(card.preserved).toMatch(/exactly as it was/);
  });
});
