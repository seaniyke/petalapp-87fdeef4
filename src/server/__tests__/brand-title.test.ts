import { describe, expect, it } from "vitest";
import { ensureBrandIdentity } from "@/server/brand-identity.server";

const html = (t: string) => `<!doctype html><html><head><title>${t}</title></head><body></body></html>`;
const title = (files: { path: string; content: string }[]) =>
  /<title>([^<]*)<\/title>/.exec(files.find((f) => f.path === "index.html")!.content)?.[1];

describe("browser tab title", () => {
  it("replaces the generic 'App' title with the header wordmark, ignoring kit sample copy", () => {
    const out = ensureBrandIdentity([
      { path: "index.html", content: html("App") },
      { path: "src/components/examples/report.tsx", content: `<h2 className="font-semibold">Weekly report</h2>` },
      { path: "src/components/site-layout.tsx", content: `<span className="font-serif text-2xl">AURA</span>` },
    ]);
    expect(title(out.files)).toBe("Aura");
  });

  it("never overwrites a real short title", () => {
    const out = ensureBrandIdentity([
      { path: "index.html", content: html("Aura") },
      { path: "src/components/site-layout.tsx", content: `<span className="font-serif">Other</span>` },
    ]);
    expect(title(out.files)).toBe("Aura");
  });
});
