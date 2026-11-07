import { describe, expect, it } from "vitest";
import { applyTokens, hasTokenBlock, TOKENS_START } from "@/server/design-systems/apply";
import { COMPOSITION_RULES } from "@/server/engine/first-build";
import * as fs from "node:fs";

describe("legacy Kimble cleanup", () => {
  it("re-applying a package replaces an old kimble-marked block instead of adding a second one", () => {
    const old = ":root{}\n/* kimble-design-system:start */\n:root{--primary:red}\n/* kimble-design-system:end */\n";
    const pkg = { meta: { slug: "s", version: "1" }, tokensCss: ":root{--x:1}", accents: { a: { light: { primary: "blue" } } } } as never;
    const out = applyTokens(old, pkg, "a");
    expect(out).toContain(TOKENS_START);
    expect(out).not.toContain("kimble-design-system");
    expect(out).not.toContain("--primary:red");
    expect(hasTokenBlock(old)).toBe(true);
  });
  it("new sites never switch to forced dark colours because the phone is in dark mode", () => {
    const src = fs.readFileSync("src/server/scaffold-kit.ts", "utf8");
    expect(src).not.toMatch(/:root:not\(\.light\):not\(\.dark\)/);
  });
  it("the builder is told never to invent photo links", () => {
    expect(COMPOSITION_RULES).toContain("Never write any other image URL");
    expect(COMPOSITION_RULES).not.toContain("Kimble");
  });
});
