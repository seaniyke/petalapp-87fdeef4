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
// (Used by the future render-smoke fixture; left here so Phase 5 can wire it.)
const RUNTIME_CRASH_PAGE = `export default function Crash({ items }: { items?: { id: string }[] }) {
  // Accesses .length on a value that may be undefined — render throws.
  const total: number = (items as { id: string }[]).length;
  return <div>{total}</div>;
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
    name: "dangling named import — Phase 2 will catch this; today it slips through",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/store.ts", content: STORE_FILE },
      { path: "src/App.tsx", content: PAGE_USING_DANGLING_NAMED },
    ],
    changedPaths: ["src/store.ts", "src/App.tsx"],
    // Today: empty (slips through). After Phase 2: ["useFooStore"].
    // We set this to [] so the test passes today and we'll flip it when
    // Phase 2 lands. The fixture is here to make that flip a one-line PR.
    expectIssueIncludes: [],
  },
  {
    name: "render-time crash — Phase 5 will catch this",
    files: [
      { path: "package.json", content: PACKAGE_JSON },
      { path: "index.html", content: INDEX_HTML },
      { path: "src/App.tsx", content: RUNTIME_CRASH_PAGE },
    ],
    changedPaths: ["src/App.tsx"],
    // Today: passes verifier (parses fine). Phase 5's render gate will flag it.
    expectIssueIncludes: [],
  },
];
