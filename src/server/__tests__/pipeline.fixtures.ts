/**
 * Frozen fixtures for the pipeline regression harness.
 *
 * Each fixture is a (path, content) tuple plus the LocalIssue/budget
 * verdict it MUST produce. If any verifier change accidentally regresses
 * its detection, the test will fail loudly instead of silently shipping
 * broken code through the gates.
 *
 * Keep these small and focused — one failure mode per fixture.
 */

export interface PipelineFixture {
  name: string;
  files: { path: string; content: string }[];
  changedPaths: string[];
  /** Substring(s) we expect to find in at least one local-verifier issue.detail.
   *  Empty array = expect verifier to PASS (ok=true, no issues). */
  expectIssueIncludes: string[];
  /** When set, fixture also asserts the file-budget verdict. */
  expectBudget?: {
    rejections: number;
    warnings: number;
  };
}

const HEALTHY_PAGE = `import { Container, Stack } from "@/components/ui/container";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <Container>
      <Stack gap={4}>
        <h1 className="text-4xl font-bold text-foreground">Hello</h1>
        <Button>Click me</Button>
      </Stack>
    </Container>
  );
}
`;

// Truncated mid-JSX (no closing </Container> / </function>).
const TRUNCATED_PAGE = `import { Container } from "@/components/ui/container";

export default function Home() {
  return (
    <Container>
      <h1 className="text-4xl font-bold text-foreground">Hello, this string never clo`;

// 320 lines of valid TSX → triggers HARD reject (>280).
const oversize = (() => {
  const lines: string[] = [
    `import { Container } from "@/components/ui/container";`,
    ``,
    `export default function Big() {`,
    `  return (`,
    `    <Container>`,
  ];
  for (let i = 0; i < 310; i++) {
    lines.push(`      <p className="text-foreground">Line ${i}</p>`);
  }
  lines.push(`    </Container>`, `  );`, `}`, ``);
  return lines.join("\n");
})();

// 200 lines → triggers SOFT warn (181-280 range).
const softWarnFile = (() => {
  const lines: string[] = [
    `import { Container } from "@/components/ui/container";`,
    ``,
    `export default function Med() {`,
    `  return (`,
    `    <Container>`,
  ];
  for (let i = 0; i < 195; i++) {
    lines.push(`      <p>Line ${i}</p>`);
  }
  lines.push(`    </Container>`, `  );`, `}`, ``);
  return lines.join("\n");
})();

// Imports a package that's not in package.json → missing-dep.
const HALLUCINATED_PACKAGE = `import toast from "react-cooler-toast-9001";

export default function App() {
  toast("hi");
  return <div>app</div>;
}
`;

// Page imports { useFooStore } but store.ts only exports useStore.
const STORE_FILE = `import { create } from "zustand";

export const useStore = create<{ count: number }>(() => ({ count: 0 }));
`;
const PAGE_USING_DANGLING_NAMED = `import { useFooStore } from "./store";

export default function Page() {
  const s = useFooStore();
  return <div>{s.count}</div>;
}
`;

// Page that PARSES fine but throws on render: reads .length on undefined prop.
// Phase 5's render-risk linter (Tier 2.8) catches this via R1.
const RUNTIME_CRASH_PAGE = `export default function Crash({ items }: { items?: { id: string }[] }) {
  // Accesses .length on a value that may be undefined — render throws.
  const total: number = items.length;
  return <div>{total}</div>;
}
`;

// R1 SAFE: optional prop with default value in destructure.
const SAFE_PROP_WITH_DEFAULT = `export default function Safe({ items = [] }: { items?: { id: string }[] }) {
  return <div>{items.map((i) => i.id).join(",")}</div>;
}
`;

// R1 SAFE: optional prop guarded by early return before unsafe access.
const SAFE_PROP_WITH_GUARD = `export default function SafeGuard({ items }: { items?: { id: string }[] }) {
  if (!items) return null;
  return <div>{items.map((i) => i.id).join(",")}</div>;
}
`;

// R2: hook called inside an if branch.
const CONDITIONAL_HOOK_PAGE = `import { useState } from "react";
export default function Cond({ enabled }: { enabled: boolean }) {
  if (enabled) useState(0);
  return <div>x</div>;
}
`;

// R3: JSX references a typo'd identifier.
const JSX_TYPO_PAGE = `export default function Typo() {
  const title = "Hello";
  return <div>{titel}</div>;
}
`;

const PACKAGE_JSON = `{
  "name": "test-app",
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^4.5.0"
  }
}
`;
const INDEX_HTML = `<!doctype html><html><body><div id="root"></div></body></html>`;

export const FIXTURES: PipelineFixture[] = [
  {
    name: "clean turn — verifier passes, no budget hit",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: HEALTHY_PAGE },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: [],
    expectBudget: { rejections: 0, warnings: 0 },
  },
  {
    name: "truncated stream — verifier flags truncation OR braces OR unterminated-string",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: TRUNCATED_PAGE },
    ],
    changedPaths: ["src/App.tsx"],
    // Any one of these substrings is acceptable — the verifier picks the
    // first that fires. We just want to know SOMETHING flagged it.
    expectIssueIncludes: ["src/App.tsx"],
  },
  {
    name: "oversize file — budget rejects",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: oversize },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: [],
    expectBudget: { rejections: 1, warnings: 0 },
  },
  {
    name: "soft-warn file — budget warns but does not reject",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: softWarnFile },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: [],
    expectBudget: { rejections: 0, warnings: 1 },
  },
  {
    name: "hallucinated npm package — verifier flags missing-dep",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: HALLUCINATED_PACKAGE },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: ["react-cooler-toast-9001"],
  },
  {
    name: "dangling named import — Phase 2 missing-export detection",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/store.ts", content: STORE_FILE },
      { path: "src/App.tsx", content: PAGE_USING_DANGLING_NAMED },
    ],
    changedPaths: ["src/store.ts", "src/App.tsx"],
    expectIssueIncludes: ["useFooStore"],
  },
  {
    name: "render-time crash — Phase 5 render-risk R1 catches optional-prop access",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: RUNTIME_CRASH_PAGE },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: ["items"],
  },
  {
    name: "clean — R1 safe with default destructure (must NOT fire)",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: SAFE_PROP_WITH_DEFAULT },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: [],
  },
  {
    name: "clean — R1 safe with early-return guard (must NOT fire)",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: SAFE_PROP_WITH_GUARD },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: [],
  },
  {
    name: "render-time crash — Phase 5 render-risk R2 catches conditional hook",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: CONDITIONAL_HOOK_PAGE },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: ["useState"],
  },
  {
    name: "render-time crash — Phase 5 render-risk R3 catches JSX typo",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: JSX_TYPO_PAGE },
    ],
    changedPaths: ["src/App.tsx"],
    expectIssueIncludes: ["titel"],
  },
];
