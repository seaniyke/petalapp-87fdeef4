import { describe, expect, it } from "vitest";
import { injectPetalBadge } from "@/server/petal-badge.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";

const INDEX_HTML =
  '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

function inlineScripts(html: string): string[] {
  return Array.from(html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1] ?? "");
}

describe("final index.html injectors", () => {
  it("keep combined guard and badge scripts parse-safe and executable", () => {
    const guarded = injectPreviewGuard([{ path: "index.html", content: INDEX_HTML }]).files;
    const files = injectPetalBadge(guarded);
    const html = files.find((file) => file.path === "index.html")?.content ?? "";
    const scripts = inlineScripts(html);

    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(script).not.toMatch(/<[^\s=(),;]/);
      expect(script).not.toContain("innerHTML");
      expect(() => new Function(script)).not.toThrow();
    }
  });

  it("remains idempotent when both injectors run again", () => {
    const first = injectPetalBadge(injectPreviewGuard([{ path: "index.html", content: INDEX_HTML }]).files);
    const second = injectPetalBadge(injectPreviewGuard(first).files);
    const html = second.find((file) => file.path === "index.html")?.content ?? "";

    expect((html.match(/id="petal-badge-loader"/g) ?? [])).toHaveLength(1);
    expect((html.match(/data-petal-preview-guard-version=/g) ?? [])).toHaveLength(1);
  });
});