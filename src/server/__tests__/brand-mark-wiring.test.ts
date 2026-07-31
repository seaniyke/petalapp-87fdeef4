import { strict as assert } from "node:assert";
import { ensureBrandMarkWired } from "../brand-identity.server";

const header = (body: string) => ({
  path: "src/components/site-header.tsx",
  content: body,
});

// 1. Undeclared tag → module created + import injected.
{
  const out = ensureBrandMarkWired([
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
  ]);
  const hdr = out.files.find((f) => f.path === "src/components/site-header.tsx")!;
  assert.ok(hdr.content.includes('import { BrandMark } from "@/components/brand-mark";'));
  const mark = out.files.find((f) => f.path === "src/components/brand-mark.tsx");
  assert.ok(mark?.content.includes("export function BrandMark"));
}

// 2. Already wired → untouched, and idempotent.
{
  const files = [
    header(`import { BrandMark } from "@/components/brand-mark";
export const H = () => <BrandMark />;
`),
    {
      path: "src/components/brand-mark.tsx",
      content: "export function BrandMark() { return null; }",
    },
  ];
  const once = ensureBrandMarkWired(files);
  const twice = ensureBrandMarkWired(once.files);
  assert.equal(once.files[0].content, files[0].content);
  assert.deepEqual(
    twice.files.map((f) => f.content),
    once.files.map((f) => f.content),
  );
  assert.equal(twice.notes.length, 0);
}

// 3. Stub module missing the named export gets repaired.
{
  const out = ensureBrandMarkWired([
    header(`import { BrandMark } from "@/components/brand-mark";
export const H = () => <BrandMark />;
`),
    {
      path: "src/components/brand-mark.tsx",
      content: "export default function Stub() { return null; }",
    },
  ]);
  const mark = out.files.find((f) => f.path === "src/components/brand-mark.tsx")!;
  assert.ok(mark.content.includes("export function BrandMark"));
}

// 4. Mentions inside strings/comments are not usages.
{
  const out = ensureBrandMarkWired([
    header(`// render <BrandMark /> here later
export const H = () => <div>{"<BrandMark />"}</div>;
`),
  ]);
  assert.equal(out.notes.length, 0);
  assert.equal(out.files.length, 1);
}

console.log("brand-mark-wiring: all assertions passed");
