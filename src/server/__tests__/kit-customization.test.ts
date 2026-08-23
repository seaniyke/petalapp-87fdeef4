import { describe, expect, it } from "vitest";
import {
  applyScaffoldKit,
  applyScaffoldKitForPatch,
  isCustomizedKitFile,
  markKitFileCustomized,
} from "@/server/scaffold-kit";

const BLOCK = "src/components/blocks/footer-columns.tsx";
const UI = "src/components/ui/button.tsx";

describe("customized kit files", () => {
  it("stamps customizable kit paths only once", () => {
    const once = markKitFileCustomized(BLOCK, "export const A = 1;\n");
    expect(isCustomizedKitFile(BLOCK, once)).toBe(true);
    expect(markKitFileCustomized(BLOCK, once)).toBe(once);
  });

  it("never stamps library primitives", () => {
    const out = markKitFileCustomized(UI, "export const Button = () => null;\n");
    expect(out).toBe("export const Button = () => null;\n");
    expect(isCustomizedKitFile(UI, out)).toBe(false);
  });

  it("keeps a redesigned block across a patch-turn kit refresh", () => {
    const custom = markKitFileCustomized(BLOCK, "export function FooterColumns(){return null;}\n");
    const out = applyScaffoldKitForPatch([
      { path: "index.html", content: "<html></html>" },
      { path: BLOCK, content: custom },
    ]);
    expect(out.find((f) => f.path === BLOCK)?.content).toBe(custom);
  });

  it("keeps a redesigned block across a full build-time kit apply", () => {
    const custom = markKitFileCustomized(BLOCK, "export function FooterColumns(){return null;}\n");
    const out = applyScaffoldKit([
      { path: "index.html", content: "<html></html>" },
      { path: BLOCK, content: custom },
    ]);
    expect(out.find((f) => f.path === BLOCK)?.content).toBe(custom);
  });

  it("still refreshes un-customized stale blocks", () => {
    const out = applyScaffoldKit([
      { path: "index.html", content: "<html></html>" },
      { path: BLOCK, content: "// stale copy\n" },
    ]);
    expect(out.find((f) => f.path === BLOCK)?.content).not.toBe("// stale copy\n");
  });
});
