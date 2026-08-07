import { strict as assert } from "node:assert";
import { fixMarkdownFences, escapeFencesInTemplates } from "../markdown-fence-fixer.server";

// 1. Markdown content inside a template literal with unescaped backticks —
//    the exact PostPage.tsx crash ("Expected ';' but found 'typescript'").
const broken = [
  "const POST = `",
  "# Title",
  "",
  "```typescript",
  "function greet(name: string) {",
  "  return `Hello, ${name}!`;",
  "}",
  "```",
  "",
  "Thanks!",
  "`;",
  "",
  "export default POST;",
].join("\n");

const healed = fixMarkdownFences([{ path: "src/pages/PostPage.tsx", content: broken }]);
const out = healed.files[0].content;
assert.ok(out.includes("\\`\\`\\`typescript"), "fence backticks must be escaped, not dropped");
assert.ok(out.includes("function greet"), "content must be preserved");
assert.ok(out.includes("\\${name}"), "interpolation inside the sample must be escaped");
assert.ok(healed.notes.length > 0);

// 2. A correctly escaped file must be left byte-identical.
const good = [
  "const POST = `",
  "\\`\\`\\`ts",
  "const x = 1;",
  "\\`\\`\\`",
  "`;",
].join("\n");
assert.equal(fixMarkdownFences([{ path: "a.tsx", content: good }]).files[0].content, good);

// 3. Idempotent.
const once = fixMarkdownFences([{ path: "a.tsx", content: broken }]).files[0].content;
const twice = fixMarkdownFences([{ path: "a.tsx", content: once }]).files[0].content;
assert.equal(twice, once);

// 4. A genuinely leaked fence in code position is still stripped.
const leaked = ['import { a } from "./a";', "", "```typescript", "const b = 1;", "```", ""].join("\n");
const strippedOut = fixMarkdownFences([{ path: "a.tsx", content: leaked }]).files[0].content;
assert.ok(!strippedOut.includes("```"), "leaked chat fences must be removed");

// 5. Plain templates with no fences are untouched.
const plain = "const t = `hello ${name}`;\n";
assert.equal(escapeFencesInTemplates(plain).escaped, 0);

console.log("markdown-fence-fixer: ok");
