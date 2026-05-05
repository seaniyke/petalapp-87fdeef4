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

console.log(`\n${failed === 0 ? "✓ all assertions passed" : `✗ ${failed} assertion(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);