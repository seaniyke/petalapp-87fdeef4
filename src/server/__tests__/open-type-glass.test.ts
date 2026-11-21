import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const kit = readFileSync("src/server/scaffold-kit.ts", "utf8");
const obs = readFileSync("src/server/design-systems/packages/obsidian/tokens.css", "utf8");
describe("open type and glass buttons", () => {
  it("display letter spacing is never squeezed past -0.02em", () => {
    for (const m of kit.matchAll(/--(?:text-\w+--letter-spacing|tracking-\w+):\s*(-?[\d.]+)em/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(-0.02);
    }
  });
  it("buttons ship a glass variant", () => {
    expect(kit).toMatch(/glass: "glass edge-light/);
  });
  it("dark style uses an open sans display, not a narrow serif", () => {
    expect(obs).not.toMatch(/Instrument Serif/);
    expect(obs).toMatch(/--kimble-font-display: "Geist"/);
  });
});
