import { describe, expect, it } from "vitest";
import { ensureNativeFeel } from "@/server/native-feel.server";
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head><body></body></html>';
describe("native feel", () => {
  it("makes safe-area insets real with viewport-fit=cover", () => {
    const out = ensureNativeFeel([{ path: "index.html", content: html }])[0].content;
    expect(out).toContain("viewport-fit=cover");
    expect(out.match(/name="viewport"/g)).toHaveLength(1);
  });
  it("pads the status bar and stops rubber-band scroll only inside the app", () => {
    const out = ensureNativeFeel([{ path: "index.html", content: html }])[0].content;
    expect(out).toContain("safe-area-inset-top");
    expect(out).toContain("overscroll-behavior");
    expect(out).toContain('if(!inApp)return');
  });
  it("is idempotent", () => {
    const once = ensureNativeFeel([{ path: "index.html", content: html }]);
    expect(ensureNativeFeel(once)[0].content).toBe(once[0].content);
  });
});
