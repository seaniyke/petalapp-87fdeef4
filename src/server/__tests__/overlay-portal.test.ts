import { describe, it, expect } from "vitest";
import * as kit from "../scaffold-kit";
import * as shadcn from "../scaffold-kit-shadcn";

// Overlays must render at document.body: a blurred sticky header traps
// `fixed inset-0` children, squeezing the mobile menu into an 80px strip.
function allFiles(mod: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of Object.values(mod)) {
    if (!Array.isArray(v)) continue;
    for (const f of v as Array<{ path?: unknown; content?: unknown }>) {
      if (f && typeof f.path === "string" && typeof f.content === "string") out[f.path] = f.content;
    }
  }
  return out;
}

describe("overlay primitives portal to body", () => {
  const files = { ...allFiles(kit as never), ...allFiles(shadcn as never) };
  for (const name of ["sheet.tsx", "dialog.tsx", "alert-dialog.tsx", "drawer.tsx", "sidebar.tsx"]) {
    it(name, () => {
      const entry = Object.entries(files).find(([k]) => k.endsWith("/ui/" + name));
      expect(entry, name + " not found in kit").toBeTruthy();
      expect(entry![1]).toContain("createPortal");
      expect(entry![1]).toContain("document.body");
    });
  }
});
