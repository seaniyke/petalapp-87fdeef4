import { strict as assert } from "node:assert";
import { buildSectionExpansionPatch, wantsMoreSections } from "../section-expansion.server";

// 1. Intent detection covers the phrasings users actually send.
for (const p of [
  "Add more sections to the website",
  "add more sections",
  "can you expand the landing page with more content",
  "add another section to the app",
]) {
  assert.equal(wantsMoreSections(p), true, p);
}
assert.equal(wantsMoreSections("make the header sticky"), false);

const page = `import { Hero } from "@/components/Hero";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen">
      <Hero />
      <Footer />
    </main>
  );
}
`;

const patch = buildSectionExpansionPatch({
  currentFiles: [{ path: "src/pages/Home.tsx", content: page }],
  prompt: "Add more sections to the website",
});
assert.ok(patch, "patch should be produced");

// 2. Sections live in a new file; the page gets an import + a render call.
assert.equal(patch!.ops[0].op, "create");
assert.equal(patch!.ops.length, 3);

// 3. The ops actually apply and produce valid-looking output.
let out = page;
for (const op of patch!.ops) {
  if (op.op !== "replace") continue;
  assert.equal(out.split(op.search).length, 2, `search must be unique: ${op.search.slice(0, 40)}`);
  out = out.replace(op.search, op.replace);
}
assert.ok(out.includes('import MoreSections from "@/components/MoreSections";'));
assert.ok(out.includes("<MoreSections />"));
assert.ok(out.indexOf("<MoreSections />") < out.indexOf("<Footer />"));
assert.equal(out.match(/<\/main>/g)!.length, 1);

// 4. No page to touch → no patch (never a bogus edit).
assert.equal(
  buildSectionExpansionPatch({ currentFiles: [], prompt: "add more sections" }),
  null,
);

console.log("section-expansion: all assertions passed");
