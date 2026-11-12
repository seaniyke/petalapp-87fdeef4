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

import { renderMobileGuidanceBlock } from "@/server/integrations/mobile-guidance.server";
describe("phone app polish", () => {
  it("hides the Powered-by badge inside the phone app", () => {
    const out = ensureNativeFeel([{ path: "index.html", content: "<html><head></head><body></body></html>" } as any]);
    expect(out[0].content).toContain("html.petal-app #petal-badge{display:none!important}");
  });
  it("tells mobile builds that carts start empty", () => {
    expect(renderMobileGuidanceBlock("x", { force: true })).toContain("start EMPTY");
  });
});

describe("native app standard", () => {
  it("hides the page scrollbar itself, not only inner ones", () => {
    const out = ensureNativeFeel([{ path: "index.html", content: html }])[0].content;
    expect(out).toContain("html.petal-app::-webkit-scrollbar");
    expect(out).toContain("html.petal-app body::-webkit-scrollbar");
  });
  it("tells mobile builds that product taps open a full page, never a sheet", () => {
    const g = renderMobileGuidanceBlock("x", { force: true });
    expect(g).toContain("NAVIGATES to its own full-screen detail page");
    expect(g).toContain("NEVER open details in a bottom sheet");
  });
});
