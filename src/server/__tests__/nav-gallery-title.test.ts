import { describe, it, expect } from "vitest";
import { CRAFT_BASELINE } from "../design-systems/craft-baseline";
import { ensureBrandIdentity } from "../brand-identity.server";

describe("nav, gallery and tab title craft", () => {
  it("requires every page in navigation", () => {
    expect(CRAFT_BASELINE).toMatch(/Navigation lists every page/);
  });
  it("requires gallery tiles to fill their cells", () => {
    expect(CRAFT_BASELINE).toMatch(/no dead space/);
  });
  it("strips 'Site' filler from the tab title", () => {
    const files = [{ path: "index.html", content: "<html><head><title>Atelier Lace Site</title></head><body></body></html>" }];
    const out = ensureBrandIdentity(files as never) as unknown as { files?: { path: string; content: string }[] };
    const html = (out.files ?? (files as never)).find((f: { path: string }) => f.path === "index.html")!.content;
    expect(html).toContain("<title>Atelier Lace</title>");
  });
});

import { enforceLayoutHygiene } from "../layout-hygiene.server";
describe("media tiles keep their photo flush", () => {
  it("does not pad a rounded min-height photo tile", () => {
    const src = `export default function A(){return <Link to="/x" className="relative rounded-2xl overflow-hidden min-h-[580px]"><img src="a.jpg" className="w-full h-full object-cover" /></Link>}`;
    const out = enforceLayoutHygiene([{ path: "src/pages/Home.tsx", content: src }] as never);
    expect(out.files[0]!.content).not.toContain("py-16");
  });
});
