import { describe, expect, it } from "vitest";
import { ensureBrandMarkWired } from "@/server/brand-identity.server";

const header = (body: string) => ({
  path: "src/components/site-header.tsx",
  content: body,
});

describe("ensureBrandMarkWired", () => {
  it("creates the module and injects the import when the tag is undeclared", () => {
    const files = [
      header(`import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header>
      <BrandMark className="h-8 w-8" />
      <Button>Go</Button>
    </header>
  );
}
`),
    ];
    const out = ensureBrandMarkWired(files);
    const hdr = out.files.find((f) => f.path === "src/components/site-header.tsx")!;
    expect(hdr.content).toContain('import { BrandMark } from "@/components/brand-mark";');
    const mark = out.files.find((f) => f.path === "src/components/brand-mark.tsx");
    expect(mark?.content).toContain("export function BrandMark");
  });

  it("is idempotent and leaves already-imported files untouched", () => {
    const files = [
      header(`import { BrandMark } from "@/components/brand-mark";
export const H = () => <BrandMark />;
`),
      { path: "src/components/brand-mark.tsx", content: "export function BrandMark() { return null; }" },
    ];
    const once = ensureBrandMarkWired(files);
    const twice = ensureBrandMarkWired(once.files);
    expect(once.files[0].content).toBe(files[0].content);
    expect(twice.files.map((f) => f.content)).toEqual(once.files.map((f) => f.content));
    expect(twice.notes).toHaveLength(0);
  });

  it("repairs a stub module that lost the named export", () => {
    const files = [
      header(`import { BrandMark } from "@/components/brand-mark";
export const H = () => <BrandMark />;
`),
      { path: "src/components/brand-mark.tsx", content: "export default function Stub() { return null; }" },
    ];
    const out = ensureBrandMarkWired(files);
    const mark = out.files.find((f) => f.path === "src/components/brand-mark.tsx")!;
    expect(mark.content).toContain("export function BrandMark");
  });

  it("ignores the tag inside strings and comments", () => {
    const files = [
      header(`// render <BrandMark /> here later
export const H = () => <div>{"<BrandMark />"}</div>;
`),
    ];
    const out = ensureBrandMarkWired(files);
    expect(out.notes).toHaveLength(0);
    expect(out.files).toHaveLength(1);
  });
});
