import { describe, expect, it } from "vitest";
import { buildImportGraph, computeImpact, resolveSpecifier } from "@/server/impact-graph.server";
import { classifyEditDeterministic, parseClassification } from "@/server/edit-classifier.server";
import { parseCraftDefects } from "@/server/craft-qa.server";
import { parseAgentOutput, mergeAgentOutputs } from "@/server/agents/model-agent.server";
import { reconcile } from "@/server/agents/runtime";
import { createTurnContext } from "@/server/agents/context";

const files = [
  { path: "src/App.tsx", content: `import Home from "./pages/Home";\nimport { NavBar } from "@/components/NavBar";` },
  { path: "src/pages/Home.tsx", content: `import { Hero } from "../components/Hero";\nexport default function Home(){return <Hero/>;}` },
  { path: "src/components/Hero.tsx", content: `import { Button } from "@/components/ui/button";\nexport const Hero = () => null;` },
  { path: "src/components/NavBar.tsx", content: `export const NavBar = () => null;` },
  { path: "src/components/ui/button.tsx", content: `export const Button = () => null;` },
];

describe("impact graph", () => {
  it("resolves alias and relative specifiers", () => {
    const known = new Set(files.map((f) => f.path));
    expect(resolveSpecifier("src/App.tsx", "@/components/NavBar", known)).toBe("src/components/NavBar.tsx");
    expect(resolveSpecifier("src/pages/Home.tsx", "../components/Hero", known)).toBe("src/components/Hero.tsx");
    expect(resolveSpecifier("src/App.tsx", "react", known)).toBeNull();
  });

  it("maps project imports only", () => {
    const graph = buildImportGraph(files);
    expect(graph.get("src/App.tsx")).toEqual([
      "src/pages/Home.tsx",
      "src/components/NavBar.tsx",
    ]);
  });

  it("returns dependents and dependencies of a seed", () => {
    const impact = computeImpact(files, ["src/components/Hero.tsx"]);
    expect(impact.dependents).toContain("src/pages/Home.tsx");
    expect(impact.dependencies).toContain("src/components/ui/button.tsx");
    expect(impact.paths[0]).toBe("src/components/Hero.tsx");
  });

  it("caps the blast radius", () => {
    const impact = computeImpact(files, ["src/components/Hero.tsx"], { max: 2 });
    expect(impact.paths).toHaveLength(2);
  });

  it("is empty for unknown seeds", () => {
    expect(computeImpact(files, ["src/nope.tsx"]).paths).toEqual([]);
  });
});

describe("edit classifier", () => {
  it("treats redesign language as structural", () => {
    expect(classifyEditDeterministic("redesign the whole site").scope).toBe("structural");
    expect(classifyEditDeterministic("this looks generic, make it a real product").scope).toBe(
      "structural",
    );
  });

  it("treats a short single-verb ask as micro", () => {
    expect(classifyEditDeterministic("change the button colour to green").scope).toBe("micro");
  });

  it("defaults to targeted", () => {
    expect(
      classifyEditDeterministic("the pricing section should list three tiers with annual toggle")
        .scope,
    ).toBe("targeted");
  });

  it("parses model verdicts and rejects junk", () => {
    const ok = parseClassification('{"scope":"structural","dimensions":["visual","x"],"hints":["Hero"],"reason":"r"}');
    expect(ok?.scope).toBe("structural");
    expect(ok?.dimensions).toEqual(["visual"]);
    expect(ok?.hints).toEqual(["hero"]);
    expect(parseClassification('{"scope":"huge"}')).toBeNull();
    expect(parseClassification("not json")).toBeNull();
  });
});

describe("craft QA parsing", () => {
  it("keeps known kinds and drops taste notes", () => {
    const out = parseCraftDefects(
      '{"defects":[{"kind":"flat-hero","where":"hero","fix":"Add a product visual"},{"kind":"vibes","where":"x","fix":"nicer"}]}',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Craft QA \(flat-hero\) — hero: Add a product visual$/);
  });

  it("returns nothing for malformed output", () => {
    expect(parseCraftDefects("sorry, no json here")).toEqual([]);
  });
});

describe("model agent output", () => {
  it("parses decisions and objections with fallbacks", () => {
    const out = parseAgentOutput(
      '{"decisions":[{"kind":"bogus","claim":"Ship a real empty state"}],"objections":[{"againstId":"product-1","severity":"nope","ask":"Encrypt tokens"}]}',
      "ux",
    );
    expect(out.decisions?.[0]).toMatchObject({ kind: "ux", claim: "Ship a real empty state" });
    expect(out.objections?.[0]).toMatchObject({ severity: "concern", againstId: "product-1" });
  });

  it("merges without duplicating claims", () => {
    const merged = mergeAgentOutputs(
      { decisions: [{ kind: "ux", claim: "Same claim" }] },
      { decisions: [{ kind: "ux", claim: "same claim" }, { kind: "ux", claim: "New claim" }] },
    );
    expect(merged.decisions).toHaveLength(2);
  });
});

describe("reconciliation precedence", () => {
  it("supersedes a lower-ranked decision and promotes the ask", () => {
    const ctx = createTurnContext({ turnId: "t1", prompt: "build" });
    ctx.decisions.push({ id: "design-1", agent: "design", kind: "design", claim: "Store the API key in localStorage" });
    ctx.objections.push({ id: "security-1", agent: "security", againstId: "design-1", severity: "blocking", ask: "Never store secrets client-side" });

    reconcile(ctx);

    expect(ctx.decisions.find((d) => d.id === "design-1")).toBeUndefined();
    expect(ctx.decisions.some((d) => d.claim === "Never store secrets client-side")).toBe(true);
  });

  it("keeps a higher-ranked decision but still carries the ask", () => {
    const ctx = createTurnContext({ turnId: "t2", prompt: "build" });
    ctx.decisions.push({ id: "product-1", agent: "product", kind: "product", claim: "Ship a booking flow" });
    ctx.objections.push({ id: "design-2", agent: "design", againstId: "product-1", severity: "blocking", ask: "Booking needs a confirmation screen" });

    reconcile(ctx);

    expect(ctx.decisions.find((d) => d.id === "product-1")).toBeDefined();
    expect(ctx.decisions.some((d) => d.claim === "Booking needs a confirmation screen")).toBe(true);
  });

  it("collapses duplicate asks", () => {
    const ctx = createTurnContext({ turnId: "t3", prompt: "build" });
    ctx.decisions.push({ id: "ux-1", agent: "ux", kind: "ux", claim: "One page" });
    ctx.objections.push(
      { id: "a", agent: "qa", againstId: "ux-1", severity: "blocking", ask: "Add an error state" },
      { id: "b", agent: "design", againstId: "ux-1", severity: "blocking", ask: "add an error state" },
    );

    reconcile(ctx);

    expect(ctx.decisions.filter((d) => /error state/i.test(d.claim))).toHaveLength(1);
  });
});
