import assert from "node:assert";
import { fixJsxAttrLiterals } from "../jsx-attr-literal-fixer.server";

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
