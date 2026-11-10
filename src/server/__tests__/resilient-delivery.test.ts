import { describe, it, expect } from "vitest";
import { TurnLedger, commitTurn } from "@/server/execution";
import { resilientFallback } from "@/server/engine/resilient-fallback";
import { TURN_LIMITS } from "@/server/execution/ledger";
import { MAX_REPAIRED_FILES, RECOVERY_LIMITS } from "@/server/engine/recovery-policy";

const main = { path: "src/main.tsx", content: 'import App from "./App";\nApp;' };
const app = { path: "src/App.tsx", content: 'import Home from "./pages/Home";\nimport About from "./pages/About";\nexport default function App(){return null}' };
const home = { path: "src/pages/Home.tsx", content: "export default function Home(){return null}" };
const aboutGood = { path: "src/pages/About.tsx", content: "export default function About(){return null}" };
const aboutBroken = { path: "src/pages/About.tsx", content: "export default function About(){ broken" };

const verifySource = async (tree: Array<{ path: string; content: string }>) => {
  const bad = tree.find((f) => f.content.includes("broken"));
  return bad
    ? { status: "FAILED" as const, gates: [], failedGate: "syntax", reason: "parse error", repairTargets: [bad.path] }
    : { status: "READY" as const, gates: [], failedGate: null, reason: null, repairTargets: [] };
};

describe("resilient delivery (prior verified content only)", () => {
  it("a broken edit to an existing page returns to its previous working version and the rest lands", async () => {
    const baseline = [main, app, home, aboutGood];
    const newHome = { ...home, content: "export default function Home(){return 1}" };
    const r = await commitTurn({
      baseline,
      proposed: [main, app, newHome, aboutBroken],
      ledger: new TurnLedger(),
      isSystemPath: () => true,
      protectionReason: () => null,
      checks: [],
      cancelled: () => false,
      verifySource,
      fallbackFor: (p, tree) => resilientFallback(p, tree, baseline),
    });
    expect(r.outcome.status).toBe("committed");
    expect(r.substituted.map((s) => s.path)).toEqual([aboutGood.path]);
  });

  it("never invents a stand-in for a page that did not exist before", () => {
    expect(resilientFallback(aboutBroken.path, [main, app, home, aboutBroken], [main])).toBeNull();
  });

  it("limits sit far above a large multi-page build", () => {
    expect(TURN_LIMITS.ai_call).toBeGreaterThanOrEqual(80);
    expect(TURN_LIMITS.write).toBeGreaterThanOrEqual(240);
    expect(MAX_REPAIRED_FILES).toBeGreaterThanOrEqual(40);
    expect(RECOVERY_LIMITS.broken_file).toBeGreaterThanOrEqual(3);
  });
});
