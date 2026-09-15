import { describe, it, expect } from "vitest";
import { pickThemeForBrief } from "../themes.server";
import { pickTemplateForBrief } from "../templates.server";
import { findGenerationQualityIssues } from "../generation-quality-gate.server";

describe("design variety", () => {
  it("does not give every unmatched brief the same theme", () => {
    const seeds = Array.from({ length: 24 }, (_, i) => `project-${i}`);
    const picks = new Set(seeds.map((s) => pickThemeForBrief("build me a website", s)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("is stable for a given seed", () => {
    const a = pickThemeForBrief("a landing page", "project-abc");
    const b = pickThemeForBrief("a landing page", "project-abc");
    expect(a).toBe(b);
  });

  it("still honours strong keyword signals", () => {
    const seeds = ["p1", "p2", "p3", "p4", "p5"];
    for (const s of seeds) {
      expect(pickThemeForBrief("an arcade pixel game jam site", s)).toBe(
        "retro-arcade",
      );
    }
  });


  it("returns null templates for briefs with no strong match", () => {
    expect(pickTemplateForBrief("something entirely unclear", "seed")).toBeNull();
  });

  it("returns a stable template for a given seed", () => {
    const a = pickTemplateForBrief("an online store selling shoes", "seed-1");
    const b = pickTemplateForBrief("an online store selling shoes", "seed-1");
    expect(a).toBe(b);
  });

  it("rejects a technically rendered but visually empty restaurant", () => {
    const issues = findGenerationQualityIssues(
      [
        {
          path: "src/App.tsx",
          content: `export default function App(){return <main><h1>Reserve a table</h1><footer>Open daily</footer></main>}`,
        },
      ],
      "marketing",
      { template: "restaurant" },
    );
    expect(issues.some((issue) => /product-depth/.test(issue.detail))).toBe(true);
    expect(issues.some((issue) => /food or venue imagery/.test(issue.detail))).toBe(true);
  });

  it("accepts the core depth signals of a composed fintech dashboard", () => {
    const issues = findGenerationQualityIssues(
      [
        {
          path: "src/App.tsx",
          content: `export default function App(){return <main><h1>Available balance</h1><section>KPI trend</section><button>Send money</button><table><tbody><tr><td>Merchant transaction</td><td>Status</td></tr></tbody></table></main>}`,
        },
      ],
      "app",
      { template: "neobank-demo" },
    );
    expect(issues.some((issue) => /product-depth/.test(issue.detail))).toBe(false);
  });
});
