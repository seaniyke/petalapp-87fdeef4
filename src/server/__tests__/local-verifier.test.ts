/**
 * Targeted regression tests for the three verifier bugs surfaced by the
 * golden-app suite (see ./golden-apps/FINDINGS.md).
 *
 * These are deterministic, sub-millisecond assertions — no AI calls, no
 * network. Run with:
 *
 *   bun src/server/__tests__/local-verifier.test.ts
 *
 * Each scenario is a real pattern from generated apps that previously
 * tripped a false-positive and triggered an unnecessary autofix loop.
 */
import { verifyFilesLocal } from "../local-verifier";

let failed = 0;

function assert(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function run(label: string, fn: () => void) {
  console.log(`\n${label}`);
  fn();
}

// ---------------------------------------------------------------------------
// Bug #1 — TS generics like useState<Todo>() must not register as JSX opens.
// ---------------------------------------------------------------------------
run("Bug #1 — TS generics are not JSX", () => {
  const useStateGeneric = `
import { useState } from "react";
interface Todo { id: string; done: boolean }
type TodoItem = { id: string };
export function App() {
  const [items, setItems] = useState<Todo>({ id: "1", done: false });
  const map = new Map<string, Todo>();
  return <div>{items.id}</div>;
}
`;
  const v = verifyFilesLocal(
    [{ path: "src/routes/index.tsx", content: useStateGeneric }],
    ["src/routes/index.tsx"],
  );
  const jsx = v.issues.filter((i) => i.kind === "jsx");
  const undef = v.issues.filter((i) => i.kind === "undefined");
  assert("no false jsx imbalance for <Todo>", jsx.length === 0, JSON.stringify(jsx));
  assert("no false undefined-component for Todo", undef.length === 0, JSON.stringify(undef));
});

// ---------------------------------------------------------------------------
// Bug #2 — self-closing tags + arrow-fn props.
// ---------------------------------------------------------------------------
run("Bug #2 — self-closing JSX with arrows in props", () => {
  const selfClosing = `
import { Input } from "@/components/ui/input";
export function App() {
  return (
    <div>
      <Input value={x} onChange={(e) => setX(e.target.value)} />
      <Input value={y} />
    </div>
  );
}
`;
  const v = verifyFilesLocal(
    [{ path: "src/routes/index.tsx", content: selfClosing }],
    ["src/routes/index.tsx"],
  );
  const jsx = v.issues.filter((i) => i.kind === "jsx");
  assert(
    "self-closing <Input ... /> not flagged",
    jsx.length === 0,
    JSON.stringify(jsx),
  );

  const arrowOnly = `
export function App() {
  return <button onClick={(e) => alert(1)}>hi</button>;
}
`;
  const v2 = verifyFilesLocal(
    [{ path: "src/routes/index.tsx", content: arrowOnly }],
    ["src/routes/index.tsx"],
  );
  assert(
    "arrow `=>` in lowercase tag attrs not flagged",
    v2.issues.filter((i) => i.kind === "jsx").length === 0,
  );
});

// ---------------------------------------------------------------------------
// Bug #3 — framework deps must not flag missing-dep when no package.json
// is in the write set (scaffold supplies them).
// ---------------------------------------------------------------------------
run("Bug #3 — SCAFFOLD_DEPS allowlist", () => {
  const route = `
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
export const Route = createFileRoute("/")({ component: () => <div /> });
`;
  // No package.json in the file set — scaffold packages should still resolve.
  const v = verifyFilesLocal(
    [{ path: "src/routes/index.tsx", content: route }],
    ["src/routes/index.tsx"],
  );
  const missingDeps = v.issues.filter((i) => i.kind === "missing-dep");
  const missingSiblings = v.issues.filter((i) => i.kind === "missing-sibling");
  assert(
    "no missing-dep for @tanstack/react-router or zod",
    missingDeps.length === 0,
    JSON.stringify(missingDeps),
  );
  assert(
    "no missing-sibling for @/integrations/supabase/client (scaffold alias)",
    missingSiblings.length === 0,
    JSON.stringify(missingSiblings),
  );

  // With a package.json that omits these, we DO want to flag them.
  const pkg = `{"dependencies":{"react":"19","react-dom":"19"}}`;
  const v2 = verifyFilesLocal(
    [
      { path: "src/routes/index.tsx", content: route },
      { path: "package.json", content: pkg },
    ],
    ["src/routes/index.tsx", "package.json"],
  );
  const flagged = v2.issues
    .filter((i) => i.kind === "missing-dep")
    .map((i) => i.detail)
    .join(" | ");
  assert(
    "package.json present → real missing-deps still surface",
    flagged.includes("@tanstack/react-router") && flagged.includes("zod"),
    flagged,
  );
});

// ---------------------------------------------------------------------------
// Sanity — a genuinely unbalanced JSX file MUST still fail. We don't want
// the new tokenizer to swallow real bugs.
// ---------------------------------------------------------------------------
run("Sanity — real JSX imbalance still detected", () => {
  const broken = `
export function App() {
  return (
    <Card>
      <Header />
      <Body>
    </Card>
  );
}
function Card(p) { return null }
function Header() { return null }
function Body(p) { return null }
`;
  const v = verifyFilesLocal(
    [{ path: "src/routes/index.tsx", content: broken }],
    ["src/routes/index.tsx"],
  );
  const jsx = v.issues.filter((i) => i.kind === "jsx");
  assert("unclosed <Body> still flagged", jsx.length > 0);
});

console.log(`\n${failed === 0 ? "✓ all assertions passed" : `✗ ${failed} assertion(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
