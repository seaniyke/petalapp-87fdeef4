import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { renderBrandContractBlock } from "@/server/brand-contract.server";

const read = (p: string) => readFileSync(p, "utf8");
const pkgDir = "src/server/design-systems/packages";

describe("system-wide consistency", () => {
  it("logos are not restricted by industry", () => {
    const b = renderBrandContractBlock({ isInitial: true });
    expect(b).toMatch(/in any industry/);
    expect(b).not.toMatch(/For websites \(beauty/);
    expect(read("src/server/generate.server.ts")).not.toMatch(/themed lucide-react icon paired with the name/);
    expect(read("src/server/engine/first-build.ts")).not.toMatch(/no decorative mark drawings/);
  });
  it("fallback mark is a clean monogram without the decorative blob or gradient", () => {
    const s = read("src/server/brand-identity.server.ts");
    expect(s).not.toMatch(/linearGradient id=\{\\`bm-/);
    expect(s).toMatch(/fontWeight="800"/);
  });
  it("no prompt forces a demo banner", () => {
    expect(read("src/server/domain-packs.server.ts")).not.toMatch(/banner (is )?mandatory/i);
  });
  it("glass and marquee are never banned in direction or agents", () => {
    expect(read("src/server/design-director.server.ts")).not.toMatch(/no marquee or gradient-text component/);
    expect(read("src/server/agents/registry.ts")).not.toMatch(/no glassmorphism/);
  });
  it("no package squeezes headings past -0.02em", () => {
    for (const d of readdirSync(pkgDir)) {
      let css = "";
      try { css = read(`${pkgDir}/${d}/tokens.css`); } catch { continue; }
      const m = /--kimble-tracking-heading:\s*(-?[\d.]+)em/.exec(css);
      if (m?.[1]) expect(Number(m[1])).toBeGreaterThanOrEqual(-0.02);
    }
  });
  it("starter blocks drop wide-spaced capital eyebrows", () => {
    for (const f of ["src/server/scaffold-kit-blocks.ts", "src/server/scaffold-kit-blocks-2.ts"])
      expect(read(f)).not.toMatch(/uppercase tracking-\[0\.2em\]/);
  });
});
