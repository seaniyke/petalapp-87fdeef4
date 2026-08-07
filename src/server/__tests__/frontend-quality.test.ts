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

describe("overlay hygiene", () => {
  it("flags a see-through mobile menu panel", () => {
    const out = enforceFrontendQuality([
      {
        path: "src/components/Nav.tsx",
        content: `export function Nav(){const [isMenuOpen,setMenuOpen]=useState(false);return isMenuOpen? <div className="fixed inset-0 flex flex-col gap-4 p-6">menu</div> : null}`,
      },
    ]);
    expect(out.defects.some((d) => /no opaque background/.test(d.detail))).toBe(true);
  });

  it("accepts an opaque menu panel and gives it a stacking order", () => {
    const out = enforceFrontendQuality([
      {
        path: "src/components/Nav.tsx",
        content: `export function Nav(){const [isMenuOpen,setMenuOpen]=useState(false);return isMenuOpen? <div className="fixed inset-0 bg-background p-6">menu</div> : null}`,
      },
    ]);
    expect(out.defects.some((d) => /no opaque background/.test(d.detail))).toBe(false);
    expect(out.files[0].content).toContain("z-50");
  });

  it("flags two unordered floating panels that would collide", () => {
    const out = enforceFrontendQuality([
      {
        path: "src/components/Search.tsx",
        content: `export function Search(){return <form><div className="absolute top-full w-full">calendar</div><div className="absolute top-full w-full">guests</div></form>}`,
      },
    ]);
    expect(out.defects.some((d) => /floating panels are positioned with no stacking order/.test(d.detail))).toBe(true);
  });

  it("leaves decorative gradient overlays alone", () => {
    const src = `export function Hero(){return <section className="relative"><div className="absolute inset-0 bg-gradient-to-t from-black/60 pointer-events-none" /></section>}`;
    const out = enforceFrontendQuality([{ path: "src/components/Hero.tsx", content: src }]);
    expect(out.files[0].content).toBe(src);
    expect(out.defects).toHaveLength(0);
  });
});
