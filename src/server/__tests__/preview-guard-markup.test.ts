import { describe, it, expect } from "vitest";
import { injectPreviewGuard } from "@/server/preview-guard.server";
describe("guard", () => {
  it("emits markup-safe inline script", () => {
    const { files } = injectPreviewGuard([{ path: "index.html", content: '<html><body><script type="module" src="/src/main.tsx"></script></body></html>' }]);
    const html = files.find((f) => f.path === "index.html")!.content;
    const script = html.match(/data-petal-preview-guard-version="\d+">([\s\S]*?)<\/script>/)![1];
    expect(script).not.toMatch(/<[^\s=(),;]/);
    // still valid JS
    expect(() => new Function(script)).not.toThrow();
  });
});
