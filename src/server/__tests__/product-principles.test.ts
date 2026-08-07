import { describe, it, expect } from "vitest";
import { lintProductPrinciples } from "../product-principles.server";

const f = (content: string, path = "src/routes/index.tsx") => ({ path, content });
const has = (issues: { detail: string }[], re: RegExp) => issues.some((i) => re.test(i.detail));

describe("product principles linter", () => {
  it("flags coming-soon pages", () => {
    expect(has(lintProductPrinciples([f(`<p>Coming soon</p>`)]), /Principle 3/)).toBe(true);
  });

  it("flags dead links", () => {
    expect(has(lintProductPrinciples([f(`<a href="#">Pricing</a>`)]), /dead controls/)).toBe(true);
  });

  it("flags filler feature copy", () => {
    expect(has(lintProductPrinciples([f(`<h3>Feature One</h3>`)]), /filler/)).toBe(true);
  });

  it("flags demo disclaimers", () => {
    expect(has(lintProductPrinciples([f(`<div>Demo only — no real money moves</div>`)]), /Principle 19/)).toBe(true);
  });

  it("flags Lovable brand leaks", () => {
    expect(has(lintProductPrinciples([f(`<footer>Built with Lovable</footer>`)]), /Principle 20/)).toBe(true);
  });

  it("flags hype adjectives", () => {
    expect(has(lintProductPrinciples([f(`<h1>Revolutionary invoicing</h1>`)]), /no hype/)).toBe(true);
  });

  it("ignores TODO markers in comments and shadcn primitives", () => {
    const out = lintProductPrinciples([
      f(`// TODO: refactor later\nexport const A = () => <div>Send invoice</div>;`),
      f(`<a href="#">x</a>`, "src/components/ui/button.tsx"),
    ]);
    expect(out).toHaveLength(0);
  });

  it("leaves clean product copy alone", () => {
    const out = lintProductPrinciples([f(`<h1>Track every invoice you send</h1>`)]);
    expect(out).toHaveLength(0);
  });
});
