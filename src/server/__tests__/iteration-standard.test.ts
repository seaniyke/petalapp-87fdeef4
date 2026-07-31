/**
 * Iteration Standard regression suite.
 *
 * "Build once" is the easy half. The half that loses users is turn 4: the
 * edit that silently no-ops, the stale `replace` that wipes the previous
 * turn's work, the repair pass that keeps firing forever. This suite drives
 * a realistic multi-turn edit sequence through the SAME deterministic
 * primitives the live pipeline uses (`applyOpsPartial`, `diffChangedPaths`,
 * `runAllRepairs`) and asserts the contract:
 *
 *   1. Every turn resolves to exactly one honest terminal state, decided by
 *      a byte diff — never by what the model claimed.
 *   2. A failed op never rolls back the turns before it.
 *   3. Repairs are idempotent: a healthy project fires zero passes.
 */
import { strict as assert } from "node:assert";
import {
  applyOpsPartial,
  diffChangedPaths,
  type FileOp,
  type ProjectFile,
} from "../generate.server";
import { runAllRepairs } from "../repair-all.server";

type Outcome = "applied" | "answered" | "blocked" | "failed";

/** Mirror of the server's terminal-state rule. */
function classify(
  before: ProjectFile[],
  after: ProjectFile[],
  blocked: boolean,
): { outcome: Outcome; changedPaths: string[] } {
  const changedPaths = diffChangedPaths(before, after);
  if (changedPaths.length > 0) return { outcome: "applied", changedPaths };
  return { outcome: blocked ? "blocked" : "answered", changedPaths };
}

let files: ProjectFile[] = [
  { path: "src/routes/index.tsx", content: "export default function Home() {\n  return <h1>Hello</h1>;\n}\n" },
  { path: "src/styles.css", content: ":root {\n  --primary: oklch(0.6 0.2 20);\n}\n" },
];

const turn = (ops: FileOp[]) => {
  const before = files;
  const res = applyOpsPartial(before, ops);
  files = res.files;
  return {
    ...res,
    ...classify(before, res.files, res.applied.length === 0 && ops.length > 0),
  };
};

// Turn 1 — add a new page. Applied, exactly one changed path.
const t1 = turn([
  { op: "create", path: "src/routes/about.tsx", content: "export default function About() {\n  return <p>About</p>;\n}\n" },
]);
assert.equal(t1.outcome, "applied");
assert.deepEqual(t1.changedPaths, ["src/routes/about.tsx"]);

// Turn 2 — targeted replace that matches. Applied, and ONLY that file moved.
const t2 = turn([
  { op: "replace", path: "src/routes/index.tsx", search: "<h1>Hello</h1>", replace: "<h1>Welcome</h1>" },
]);
assert.equal(t2.outcome, "applied");
assert.deepEqual(t2.changedPaths, ["src/routes/index.tsx"]);
assert.ok(files.find((f) => f.path === "src/routes/index.tsx")!.content.includes("Welcome"));

// Turn 3 — the classic silent no-op: the model "edits" a file to the exact
// bytes it already has. The op succeeds, but the turn must NOT claim applied.
const t3 = turn([
  { op: "update", path: "src/styles.css", content: ":root {\n  --primary: oklch(0.6 0.2 20);\n}\n" },
]);
assert.equal(t3.failed.length, 0, "a same-bytes update is not an apply failure");
assert.equal(t3.outcome, "answered", "no bytes moved, so the turn cannot say 'applied'");
assert.deepEqual(t3.changedPaths, []);

// Turn 4 — a stale `replace` (searches for text turn 2 already rewrote).
// It must fail in isolation, leave turn 2's work intact, and report blocked.
const t4 = turn([
  { op: "replace", path: "src/routes/index.tsx", search: "<h1>Hello</h1>", replace: "<h1>Hi</h1>" },
]);
assert.equal(t4.failed.length, 1);
assert.equal(t4.outcome, "blocked");
assert.ok(
  files.find((f) => f.path === "src/routes/index.tsx")!.content.includes("Welcome"),
  "a failed op must never roll back an earlier turn",
);

// Turn 5 — mixed batch: one good op, one stale op. Partial apply means the
// good one still lands, so the turn is `applied`, not `blocked`.
const t5 = turn([
  { op: "update", path: "src/routes/about.tsx", content: "export default function About() {\n  return <p>About us</p>;\n}\n" },
  { op: "replace", path: "src/styles.css", search: "--nope: 1;", replace: "--nope: 2;" },
]);
assert.equal(t5.applied.length, 1);
assert.equal(t5.failed.length, 1);
assert.equal(t5.outcome, "applied");
assert.deepEqual(t5.changedPaths, ["src/routes/about.tsx"]);

// Turn 6 — delete. Removal counts as a change.
const t6 = turn([{ op: "delete", path: "src/routes/about.tsx" }]);
assert.equal(t6.outcome, "applied");
assert.deepEqual(t6.changedPaths, ["src/routes/about.tsx"]);
assert.equal(files.some((f) => f.path === "src/routes/about.tsx"), false);

// Repairs must be idempotent across turns: running them twice on the same
// project fires passes at most once. A pass that keeps firing every turn is
// masking a broken shape rather than fixing it.
const firstRepair = runAllRepairs(files);
const secondRepair = runAllRepairs(firstRepair.files);
assert.deepEqual(
  secondRepair.firedPasses,
  [],
  `repairs are not idempotent — still firing: ${secondRepair.firedPasses.join(", ")}`,
);
assert.deepEqual(
  diffChangedPaths(firstRepair.files, secondRepair.files),
  [],
  "a second repair pass must be a no-op",
);

console.log("iteration-standard: all assertions passed");
