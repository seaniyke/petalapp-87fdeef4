/**
 * Correctness guards for the two code-patching primitives the generation
 * pipeline relies on: the fuzzy search/replace cascade and the AST patcher.
 *
 * Run with: bun src/server/__tests__/patch-correctness.test.ts
 */
import { strict as assert } from "node:assert";
import { fuzzyReplace } from "../fuzzy-replace";
import { applyAstPatches } from "../ast-patch.server";

// ── fuzzyReplace ────────────────────────────────────────────────────────────

// A partial-line match must not wipe the rest of the line.
const partial = fuzzyReplace(
  `export function Cta() {\n  return <Button size="lg" variant="ghost">Go</Button>;\n}\n`,
  `size="lg"`,
  `size="sm"`,
);
assert.ok(partial, "partial-line needle should match");
assert.match(partial!.content, /<Button size="sm" variant="ghost">Go<\/Button>/);
assert.match(partial!.content, /export function Cta\(\)/);

// Prettier reflow: needle on one line, file wrapped over several.
const reflow = fuzzyReplace(
  `const el = (\n  <Card\n    title="Hello"\n    subtitle="World"\n  />\n);\n`,
  `<Card title="Hello" subtitle="World" />`,
  `<Card title="Hi" />`,
);
assert.ok(reflow, "collapsed-whitespace needle should match");
assert.equal(reflow!.strategy, "collapse-whitespace");
assert.equal(reflow!.content, `const el = (\n  <Card title="Hi" />\n);\n`);

// Loose anchors with an unrelated interior must be refused.
assert.equal(
  fuzzyReplace(
    `function a() {\n  return (\n    <Alpha />\n  );\n}\nfunction b() {\n  const zzz = 1;\n  return zzz;\n}\n`,
    `  return (\n    <Beta />\n    <Gamma />\n    <Delta />\n  return zzz;`,
    "nope",
  ),
  null,
  "anchor strategy must reject a dissimilar interior",
);

// An all-whitespace needle would match everywhere.
assert.equal(fuzzyReplace("const a = 1;\n", "   \n  ", "x"), null);

// Indent-shifted block still re-indents correctly.
const indented = fuzzyReplace(
  `function x() {\n    const a = 1;\n    const b = 2;\n}\n`,
  `  const a = 1;\n  const b = 2;`,
  `const a = 9;`,
);
assert.ok(indented);
assert.equal(indented!.content, `function x() {\n    const a = 9;\n}\n`);

// ── applyAstPatches: replace-jsx-block ──────────────────────────────────────

assert.equal(
  applyAstPatches(
    `export default function P() {\n  return (\n    <div data-petal-block="hero">\n      <div />\n      <div>inner</div>\n    </div>\n  );\n}\n`,
    [{ kind: "replace-jsx-block", blockId: "hero", jsx: `<section>new</section>` }],
  ),
  `export default function P() {\n  return (\n    <section>new</section>\n  );\n}\n`,
  "self-closing nested same-name tags must not unbalance the depth scan",
);

assert.equal(
  applyAstPatches(`const a = <div data-petal-block="b" onClick={() => go()}>old</div>;\n`, [
    { kind: "replace-jsx-block", blockId: "b", jsx: `<span>new</span>` },
  ]),
  `const a = <span>new</span>;\n`,
  "'>' inside an expression container must not end the open tag",
);

// ── applyAstPatches: add-import ─────────────────────────────────────────────

const typeOnly = applyAstPatches(`import type { Foo } from "./x";\n\nconst a = 1;\n`, [
  { kind: "add-import", specifier: "bar", from: "./x" },
]);
assert.match(typeOnly, /import type \{ Foo \} from "\.\/x";/);
assert.match(typeOnly, /import \{ bar \} from "\.\/x";/);

const sideEffect = applyAstPatches(`import "./styles.css";\n\nconst a = 1;\n`, [
  { kind: "add-import", specifier: "thing", from: "./styles.css" },
]);
assert.match(sideEffect, /import \{ thing \} from "\.\/styles\.css";/);

assert.equal(
  applyAstPatches(`import { useState } from "react";\n`, [
    { kind: "add-import", specifier: "useState", from: "react" },
  ]),
  `import { useState } from "react";\n`,
  "add-import must be idempotent",
);

console.log("patch-correctness: all assertions passed");
