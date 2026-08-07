import { describe, it, expect } from "vitest";
import { injectPreviewGuard } from "@/server/preview-guard.server";
describe("guard", () => {
  it("emits markup-safe inline script", () => {
    const { files } = injectPreviewGuard([{ path: "index.html", content: '<html><body><script type="module" src="/src/main.tsx"></script></body></html>' }]);
    const html = files.find((f) => f.path === "index.html")!.content;
    const script = html.match(/data-petal-preview-guard-version="\d+">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    if (!script) return;
    expect(script).not.toMatch(/<[^\s=(),;]/);
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("/[<>&]/");
    // still valid JS
    expect(() => new Function(script)).not.toThrow();
  });
  it("replaces an unmarked legacy guard by runtime signature", () => {
    const legacy = '<html><body><script>window.__petalPreviewGuardVersion=6;var x=/[<>&]/g;</script><script type="module" src="/src/main.tsx"></script></body></html>';
    const { files } = injectPreviewGuard([{ path: "index.html", content: legacy }]);
    const html = files.find((f) => f.path === "index.html")?.content ?? "";
    expect(html).not.toContain("var x=/[<>&]/g");
    expect(html).toContain("__petalPreviewGuardVersion = VERSION");
  });
});
