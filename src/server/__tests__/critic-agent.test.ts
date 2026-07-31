import { strict as assert } from "node:assert";
import { findDeterministicDefects, criticDisclosure } from "../critic-agent.server";
import type { FileOp, ProjectFile } from "../generate.server";

const files: ProjectFile[] = [
  {
    path: "src/App.tsx",
    content: Array.from({ length: 120 }, (_, i) => `const x${i} = ${i};`).join("\n"),
  },
  { path: "src/Small.tsx", content: "export const a = 1;\n" },
];

const d = (ops: FileOp[], prompt: string) => findDeterministicDefects(ops, files, prompt);

// 1. Elision placeholders would delete the omitted region.
assert.equal(
  d(
    [{ op: "update", path: "src/App.tsx", content: "import React from 'react';\n// ... rest of the file unchanged" }],
    "make the header blue",
  ).length,
  1,
);

// 2. No-op replace and blank write.
assert.equal(
  d(
    [
      { op: "replace", path: "src/Small.tsx", search: "a = 1", replace: "a = 1" },
      { op: "update", path: "src/Small.tsx", content: "   \n" },
    ],
    "tweak",
  ).length,
  2,
);

// 3. Entry-file delete: blocked unless the user asked.
assert.equal(d([{ op: "delete", path: "src/App.tsx" }], "add a footer").length, 1);
assert.equal(d([{ op: "delete", path: "src/App.tsx" }], "delete src/App.tsx").length, 0);

// 4. Catastrophic shrink, unless a rewrite was requested.
const shrink: FileOp[] = [{ op: "update", path: "src/App.tsx", content: "export default () => null;" }];
assert.equal(d(shrink, "add a footer").length, 1);
assert.equal(d(shrink, "simplify App.tsx").length, 0);

// 5. An ordinary edit sails through.
assert.equal(d([{ op: "replace", path: "src/Small.tsx", search: "a = 1", replace: "a = 2" }], "bump a").length, 0);

// 6. Disclosure only when something was blocked.
assert.equal(criticDisclosure([]), "");
assert.ok(
  criticDisclosure([{ path: "src/App.tsx", op: "update", reason: "truncated", deterministic: true }]).includes(
    "src/App.tsx",
  ),
);

console.log("critic-agent: all assertions passed");
