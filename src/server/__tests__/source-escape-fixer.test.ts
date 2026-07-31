import { strict as assert } from "node:assert";
import { fixSourceEscapes, unescapeCodePositions } from "../source-escape-fixer.server";

// 1. Literal \n in code position (the esbuild `Syntax error "n"` crash).
const broken = 'const a = [\n  { name: "Rhys",\\n    role: "Jeweler" },\n];\n';
const fixed = unescapeCodePositions(broken);
assert.equal(fixed.count, 1);
assert.ok(!fixed.out.includes('",\\n'));
assert.match(fixed.out, /role: "Jeweler"/);

// 2. Escapes inside string / template literals must survive untouched.
const literals = 'const s = "line1\\nline2";\nconst t = `a\\tb`;\n';
const untouched = unescapeCodePositions(literals);
assert.equal(untouched.count, 0);
assert.equal(untouched.out, literals);

// 3. Template interpolation returns to code position correctly.
const tpl = "const x = `hi ${name}`;\\nconst y = 1;\n";
const tplFixed = unescapeCodePositions(tpl);
assert.equal(tplFixed.count, 1);
assert.match(tplFixed.out, /`hi \$\{name\}`;\nconst y = 1;/);

// 4. Only source files are rewritten; markdown keeps its literal escapes.
const res = fixSourceEscapes([
  { path: "src/A.tsx", content: "const a = 1;\\nconst b = 2;\n" },
  { path: "README.md", content: "keep \\n here" },
]);
assert.equal(res.notes.length, 1);
assert.match(res.files[0].content, /const a = 1;\nconst b = 2;/);
assert.equal(res.files[1].content, "keep \\n here");

// 5. Idempotent.
const second = fixSourceEscapes(res.files);
assert.equal(second.notes.length, 0);

console.log("source-escape-fixer: all assertions passed");

// Regression: an apostrophe in JSX text (not a string) used to desync the
// scanner so every later code-position `\n` was skipped.
const apostrophe = [
  "export const A = () => (",
  "  <p>Rhys's workshop</p>",
  ");",
  "const team = [",
  '  { name: "Rhys Sterling",\\n    role: "Master Jeweler" },',
  "];",
].join("\n");
const apRes = unescapeCodePositions(apostrophe);
if (apRes.count !== 1 || apRes.out.includes("\\n")) {
  throw new Error("apostrophe desync regression: " + JSON.stringify(apRes));
}
console.log("source-escape-fixer: apostrophe regression passed");
