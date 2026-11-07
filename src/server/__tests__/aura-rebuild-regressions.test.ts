import { describe, expect, it } from "vitest";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { autofixFiles } from "@/server/stream-autofixer";

const AURA =
  "Build a website for Aura Light Studio, an architectural lighting design studio in London. Pages: Home, Projects, Studio and Contact. Website only, no accounts or logins.";

describe("live Aura rebuild (c30d10ca) regressions", () => {
  it("takes the business name from 'a website for <Name>' instead of inventing one", () => {
    expect(deterministicPrd(AURA).productName).toBe("Aura Light Studio");
  });

  it("does not treat 'a website for my bakery' as a name", () => {
    expect(deterministicPrd("Build a website for my bakery in Lagos").productName).not.toMatch(/^My\b/);
  });

  it("never swaps picture placeholders for random stock photos", () => {
    const slugs = Array.from({ length: 9 }, (_, i) => `petal-image://editorial-portrait-of-team-member-${i}`);
    const content = `export const P = [${slugs.map((s) => `"${s}"`).join(",")}];`;
    const { files } = autofixFiles([{ path: "src/data/studio-data.ts", content }]);
    expect(files[0].content).not.toContain("picsum");
    for (const s of slugs) expect(files[0].content).toContain(s);
  });
});
