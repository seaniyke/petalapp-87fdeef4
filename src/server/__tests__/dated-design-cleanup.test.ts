import { describe, it, expect } from "vitest";
import * as fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("dated design cleanup", () => {
  it("editorial and neutral palettes are no longer banned", () => {
    for (const p of ["src/server/design-taste.server.ts", "src/server/dynamic-prompts.server.ts", "src/server/design-director.server.ts"]) {
      const s = read(p);
      expect(s).not.toMatch(/ink-on-cream[^\n]*(banned|BANNED|forbidden)/);
      expect(s).not.toMatch(/COLOR IS MANDATORY/);
    }
  });
  it("prompts no longer recommend gimmick effects or scrolling tickers", () => {
    const prompts = read("src/server/dynamic-prompts.server.ts") + read("src/server/design-director.server.ts") + read("src/server/design-taste.server.ts");
    expect(prompts).not.toMatch(/<LogosMarquee|<TestimonialsMarquee|<GradientBlob|CtaGradientBand/);
    expect(prompts).not.toMatch(/ShimmerButton|RainbowButton|RetroGrid|Meteors|MeshGradient|AnimatedBeam/);
    expect(prompts).not.toMatch(/scrolling marquee|mini-chart|mini-calculator/);
  });
  it("starter hero sections carry no glowing blobs or pill labels", () => {
    const kit = read("src/server/scaffold-kit-blocks.ts");
    expect(kit).not.toMatch(/blur-3xl/);
    expect(kit).not.toMatch(/rounded-full border border-border bg-background\/\d+ px-3 py-1/);
    expect(kit).not.toMatch(/<GradientBlob className/);
  });
  it("glass decoration is gone from the registry", () => {
    expect(read("src/server/registry/headers.ts")).not.toMatch(/deco-glass/);
  });
});
