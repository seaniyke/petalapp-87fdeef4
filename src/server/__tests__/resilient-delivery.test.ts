import { describe, it, expect } from "vitest";
import { TurnLedger, commitTurn } from "@/server/execution";
import { resilientFallback, placeholderPage } from "@/server/engine/resilient-fallback";
import { TURN_LIMITS } from "@/server/execution/ledger";
import { MAX_REPAIRED_FILES, RECOVERY_LIMITS } from "@/server/engine/recovery-policy";

const main = { path: "src/main.tsx", content: 'import App from "./App";\nApp;' };
const app = { path: "src/App.tsx", content: 'import Home from "./pages/Home";\nimport About from "./pages/About";\nexport default function App(){return null}' };
const home = { path: "src/pages/Home.tsx", content: "export default function Home(){return null}" };
const about = { path: "src/pages/About.tsx", content: "export default function About(){ broken" };

describe("resilient delivery", () => {
  it("replaces one broken optional page and still commits the build", async () => {
    const ledger = new TurnLedger();
    const r = await commitTurn({
      baseline: [main],
      proposed: [main, app, home, about],
      ledger,
      isSystemPath: () => false,
      protectionReason: () => null,
      checks: [],
      cancelled: () => false,
      verifySource: async (tree) => {
        const bad = tree.find((f) => f.path === about.path && f.content.includes("broken"));
        return bad
          ? { status: "FAILED", gates: [], failedGate: "syntax", reason: "parse error", repairTargets: [about.path] }
          : { status: "READY", gates: [], failedGate: null, reason: null, repairTargets: [] };
      },
      fallbackFor: (p, tree) => resilientFallback(p, tree, [main]),
    });
    expect(r.outcome.status).toBe("committed");
    expect(r.substituted.map((s) => s.path)).toEqual([about.path]);
  });

  it("never substitutes the app shell", () => {
    expect(resilientFallback(app.path, [main, app, home, about], [main])).toBeNull();
  });

  it("placeholder is a default-export page with the page title", () => {
    expect(placeholderPage("src/pages/TermsAndPrivacy.tsx")).toContain("Terms And Privacy");
  });

  it("limits sit far above a large multi-page build", () => {
    expect(TURN_LIMITS.ai_call).toBeGreaterThanOrEqual(80);
    expect(TURN_LIMITS.write).toBeGreaterThanOrEqual(240);
    expect(MAX_REPAIRED_FILES).toBeGreaterThanOrEqual(40);
    expect(RECOVERY_LIMITS.broken_file).toBeGreaterThanOrEqual(3);
  });
});
