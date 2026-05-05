import { applyOps, type ProjectFile, type FileOp } from "../generate.server";

let failed = 0;

function assert(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const files: ProjectFile[] = [
  {
    path: "src/routes/index.tsx",
    content: `export default function Home() {
  return <h1>Old heading</h1>;
}
`,
  },
];

const replaced = applyOps(files, [
  {
    op: "replace",
    path: "src/routes/index.tsx",
    search: "Old heading",
    replace: "New heading",
  },
]);

assert(
  "replace op edits an existing snippet without full-file output",
  replaced[0]?.content.includes("New heading") && !replaced[0]?.content.includes("Old heading"),
  replaced[0]?.content,
);

try {
  applyOps(files, [
    {
      op: "replace",
      path: "src/routes/index.tsx",
      search: "Missing heading",
      replace: "New heading",
    },
  ]);
  assert("replace op rejects missing snippets", false);
} catch {
  assert("replace op rejects missing snippets", true);
}

try {
  const duplicate: ProjectFile[] = [
    { path: "src/App.tsx", content: "const label = 'Save';\nconst aria = 'Save';\n" },
  ];
  applyOps(duplicate, [
    { op: "replace", path: "src/App.tsx", search: "Save", replace: "Publish" },
  ] as FileOp[]);
  assert("replace op rejects ambiguous snippets", false);
} catch {
  assert("replace op rejects ambiguous snippets", true);
}

// Workstream A — surgical-edit gate
const longPrev = Array.from({ length: 80 }, (_, i) => `const lineNumber${i} = ${i};`).join("\n");
const longFiles: ProjectFile[] = [
  { path: "src/big.tsx", content: longPrev },
];

try {
  // Identical content (~100% overlap) on a long file → must be rejected.
  applyOps(longFiles, [
    { op: "update", path: "src/big.tsx", content: longPrev + "\nconst extra = 1;" },
  ] as FileOp[]);
  assert("update gate rejects near-identical large rewrites", false);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  assert(
    "update gate rejects near-identical large rewrites",
    msg.startsWith("must_use_replace"),
    msg,
  );
}

// Genuine large rewrite (only 20% overlap) should still be accepted.
const partialRewrite = Array.from({ length: 80 }, (_, i) =>
  i < 16 ? `const lineNumber${i} = ${i};` : `const renamed_${i} = ${i * 2};`,
).join("\n");
const accepted = applyOps(longFiles, [
  { op: "update", path: "src/big.tsx", content: partialRewrite },
] as FileOp[]);
assert(
  "update gate accepts genuine rewrites with low overlap",
  accepted[0]?.content === partialRewrite,
);

// Short files always pass the gate.
const shortPrev = `export const a = 1;\nexport const b = 2;\n`;
const shortFiles: ProjectFile[] = [{ path: "src/small.ts", content: shortPrev }];
const shortNext = applyOps(shortFiles, [
  { op: "update", path: "src/small.ts", content: shortPrev + "export const c = 3;\n" },
] as FileOp[]);
assert("update gate skips short files", shortNext[0]?.content.includes("c = 3"));
