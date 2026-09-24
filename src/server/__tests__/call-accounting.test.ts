import { describe, expect, it } from "vitest";
import { explainAiCall } from "@/server/engine/call-accounting";
import { assessCompleteness } from "@/server/engine/build-state";

describe("AI call accounting", () => {
  const seen = [
    { feature: "preflight" },
    { feature: "design" },
    { feature: "memory" },
    { feature: "generate", phase: "implement", chosenBy: "smart_router:best_score" },
    { feature: "generate", phase: "implement", chosenBy: "missing_pages", recoveryReason: "missing_page" },
    { feature: "generate", phase: "implement", chosenBy: "missing_pages_provider_retry", recoveryReason: "provider_error" },
    { feature: "recovery", chosenBy: "broken_file_repair", recoveryReason: "parse_error" },
    { feature: "generate", phase: "design-contract" },
    { feature: "recovery" },
    { feature: "generate", phase: "verify-plan" },
  ];
  it("explains every call type seen in the last live build", () => {
    for (const c of seen) expect(explainAiCall(c).stage).not.toBe("unclassified");
  });
  it("labels retries and repairs", () => {
    expect(explainAiCall(seen[5]).kind).toBe("retry");
    expect(explainAiCall(seen[6]).kind).toBe("repair");
  });
});

describe("completeness ignores placeholder pages", () => {
  it("a stubbed Home page does not count as delivered", () => {
    const stub = "// Auto-generated stub by Petal import-resolver. The original import target\nexport default function Home(){return null}";
    const app = 'import Home from "./pages/Home";\n<Route path="/" element={<Home/>} />';
    const r = assessCompleteness({
      requestedRoutes: ["/"],
      files: [
        { path: "src/App.tsx", content: app },
        { path: "src/pages/Home.tsx", content: stub },
      ],
    });
    expect(r.complete).toBe(false);
    expect(r.missingRoutes).toContain("/");
  });
});
