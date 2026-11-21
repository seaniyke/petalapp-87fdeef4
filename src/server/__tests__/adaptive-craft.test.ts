import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isDarkFirst } from "@/server/design-systems/apply";
import { KIT_FLOW_FILES } from "@/server/scaffold-kit-flow";
import { HERO_CONTRACT } from "@/server/hero-contract.server";
import { CRAFT_BASELINE } from "@/server/design-systems/craft-baseline";

const read = (p: string) => readFileSync(p, "utf8");

describe("adaptive logos, modern forms, fluid width, rich heroes", () => {
  it("dark-first packages are detected so their bright accent goes on :root", () => {
    expect(isDarkFirst(read("src/server/design-systems/packages/obsidian/tokens.css"))).toBe(true);
    expect(isDarkFirst(":root { --background: oklch(0.98 0 0); }")).toBe(false);
  });
  it("the fallback logo draws in the surface's text colour, not primary", () => {
    const s = read("src/server/brand-identity.server.ts");
    expect(s).toContain("shrink-0 text-foreground");
    expect(s).not.toContain("shrink-0 text-primary");
  });
  it("form fields are large and soft", () => {
    const s = read("src/server/scaffold-kit.ts");
    expect(s).not.toContain("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm");
    expect(s).toContain("h-12 w-full rounded-xl");
  });
  it("the page is never boxed into max-w-6xl", () => {
    expect(read("src/server/agent-knowledge/system.md")).not.toContain('max-w-6xl mx-auto px-4');
    expect(read("src/server/scaffold-kit.ts")).toContain('size = "xl"');
    expect(CRAFT_BASELINE).toMatch(/Full-bleed canvas/);
  });
  it("heroes can use video and the kit ships the primitives", () => {
    expect(HERO_CONTRACT).toMatch(/HeroVideo/);
    const paths = KIT_FLOW_FILES.map((f) => f.path);
    for (const p of ["hero-video", "segmented-control", "field-group"]) expect(paths.some((x) => x.includes(p))).toBe(true);
  });
});
