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
  it("old effect pieces are deleted from the starter kit", async () => {
    expect(fs.existsSync("src/server/scaffold-kit-fx.ts")).toBe(false);
    const { KIT_FILES } = await import("@/server/scaffold-kit");
    const paths = KIT_FILES.map((f) => f.path);
    const retired = [
      "src/components/ui/marquee.tsx",
      "src/components/ui/gradient-text.tsx",
      "src/components/ui/gradient-blob.tsx",
      "src/components/blocks/hero-centered-gradient.tsx",
      "src/components/blocks/hero-product-screenshot.tsx",
      "src/components/blocks/testimonials-marquee.tsx",
      "src/components/blocks/logos-marquee.tsx",
      "src/components/blocks/cta-gradient-band.tsx",
      "src/components/examples/hero-centered-gradient.tsx",
    ];
    for (const p of retired) expect(paths).not.toContain(p);
    expect(paths.some((p) => p.startsWith("src/components/fx/"))).toBe(false);
    // Nothing left in the kit may import a deleted piece.
    const all = KIT_FILES.map((f) => f.content).join("\n");
    expect(all).not.toMatch(/from "@\/components\/fx|ui\/marquee"|ui\/gradient-text"|ui\/gradient-blob"|blocks\/(logos-marquee|testimonials-marquee|cta-gradient-band|hero-centered-gradient|hero-product-screenshot)"/);
  });
  it("glass decoration is gone from the registry", () => {
    expect(read("src/server/registry/headers.ts")).not.toMatch(/deco-glass/);
  });
});
