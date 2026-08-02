import assert from "node:assert";
import { fixJsxAttrLiterals } from "../jsx-attr-literal-fixer.server";
import { healSyntax, repairJsxAttributeLiterals } from "../../../builder/src/syntax-heal";

const broken = `export default function App() {
  const rows = [1, 2];
  return (
    <div>
      <FooterColumns
        className="py-12"
        columns=[
          { title: "Product", links: ["a", "b"] },
          { title: "Company", links: ["c"] },
        ]
      />
      <Grid cols=3 wrap=true />
      <List items={rows} />
    </div>
  );
}
`;

const res = fixJsxAttrLiterals([{ path: "src/App.tsx", content: broken }]);
const out = res.files[0].content;

assert.ok(out.includes("columns={["), "array literal wrapped");
assert.ok(out.includes("]}"), "array literal closed");
assert.ok(out.includes("cols={3}"), "number wrapped");
assert.ok(out.includes("wrap={true}"), "boolean wrapped");
assert.ok(out.includes("const rows = [1, 2];"), "plain TS array untouched");
assert.ok(out.includes("items={rows}"), "already-braced untouched");

// Idempotent.
const again = fixJsxAttrLiterals(res.files);
assert.equal(again.notes.length, 0, "second pass is a no-op");

console.log("jsx-attr-literal-fixer: all assertions passed");

// The independently deployed builder must repair the exact production failure
// too. It receives queued/retried payloads that can predate the app-side pass.
const productionFailure = `<FooterColumns
  className="py-12 md:py-16 border-t"
  columns=[
    { title: "Product", links: [{ label: "One", href: "/one" }] },
    { title: "Company", links: [] },
  ]
/>`;
const builderRepair = repairJsxAttributeLiterals(productionFailure);
assert.equal(builderRepair.count, 1, "builder repairs multiline array prop");
assert.ok(builderRepair.out.includes("columns={["), "builder inserts opening expression brace");
assert.ok(builderRepair.out.includes("]}"), "builder inserts closing expression brace");

const preflight = healSyntax([{ path: "src/App.tsx", content: productionFailure }]);
assert.equal(preflight.notes.length, 1, "materialization preflight reports the repair");
assert.ok(preflight.files[0].content.includes("columns={["), "disk-bound source is healed");
assert.equal(healSyntax(preflight.files).notes.length, 0, "builder repair is idempotent");

console.log("jsx-attr-literal-fixer: builder pre-flight assertions passed");
