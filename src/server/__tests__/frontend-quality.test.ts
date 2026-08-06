import { describe, it, expect } from "vitest";
import { enforceFrontendQuality } from "../frontend-quality.server";

const f = (path: string, content: string) => ({ path, content });

describe("frontend quality pass", () => {
  it("names icon-only buttons", () => {
    const out = enforceFrontendQuality([
      f("src/Nav.tsx", `export const N = () => <button className="p-2"><ShoppingCart /></button>;`),
    ]);
    expect(out.files[0].content).toContain('aria-label="shopping cart"');
  });

  it("leaves labelled controls alone", () => {
    const src = `<button aria-label="Close"><X /></button>`;
    const out = enforceFrontendQuality([f("src/A.tsx", src)]);
    expect(out.files[0].content).toBe(src);
  });

  it("adds alt text derived from the file name", () => {
    const out = enforceFrontendQuality([f("src/A.tsx", `<img src="/hero-shot.png" />`)]);
    expect(out.files[0].content).toContain('alt="hero shot"');
  });

  it("labels placeholder-only fields", () => {
    const out = enforceFrontendQuality([f("src/A.tsx", `<input placeholder="Email address" />`)]);
    expect(out.files[0].content).toContain('aria-label="Email address"');
  });

  it("demotes duplicate h1", () => {
    const out = enforceFrontendQuality([f("src/A.tsx", `<div><h1>One</h1><h1>Two</h1></div>`)]);
    expect(out.files[0].content).toBe(`<div><h1>One</h1><h2>Two</h2></div>`);
  });

  it("flags lorem ipsum", () => {
    const out = enforceFrontendQuality([f("src/A.tsx", `<p>Lorem ipsum dolor sit amet</p>`)]);
    expect(out.defects.some((d) => /lorem/i.test(d.detail))).toBe(true);
  });

  it("adds a reduced-motion block when the app animates", () => {
    const out = enforceFrontendQuality([
      f("src/A.tsx", `<div className="animate-pulse" />`),
      f("src/index.css", `body { margin: 0; }`),
    ]);
    expect(out.files[1].content).toContain("prefers-reduced-motion");
  });
});
