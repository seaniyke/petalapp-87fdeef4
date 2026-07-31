import { strict as assert } from "node:assert";
import { shouldRunAgentLoop, agentLoopSummaryBlock } from "../agent-loop.server";

// --- Gating: the loop must never tax a cheap turn -------------------------

// 1. First builds have nothing to inspect.
assert.equal(
  shouldRunAgentLoop({ isInitial: true, isCrossCutting: true, prompt: "rename everything", fileCount: 40 }),
  false,
);

// 2. A one-line copy tweak stays on the fast path.
assert.equal(
  shouldRunAgentLoop({
    isInitial: false,
    isCrossCutting: false,
    prompt: 'change the hero headline to "Ship faster"',
    fileCount: 30,
  }),
  false,
);

// 3. Cross-cutting work always earns the loop.
assert.equal(
  shouldRunAgentLoop({ isInitial: false, isCrossCutting: true, prompt: "redesign the app", fileCount: 30 }),
  true,
);

// 4. Mechanical/bulk phrasing earns it even when the resolver saw no spread.
for (const prompt of [
  "rename the Button variant prop",
  "make the spacing consistent throughout",
  "update the footer on every page",
  "refactor the auth helpers",
  "replace all the old logos",
]) {
  assert.equal(
    shouldRunAgentLoop({ isInitial: false, isCrossCutting: false, prompt, fileCount: 20 }),
    true,
    `expected loop for: ${prompt}`,
  );
}

// 5. A near-empty project has nothing to sweep.
assert.equal(
  shouldRunAgentLoop({ isInitial: false, isCrossCutting: true, prompt: "rename everywhere", fileCount: 1 }),
  false,
);

// 6. Matching is case-insensitive.
assert.equal(
  shouldRunAgentLoop({ isInitial: false, isCrossCutting: false, prompt: "RENAME the nav links", fileCount: 9 }),
  true,
);

// --- Summary block: what the emit call is told ----------------------------

// 7. No steps → no block at all (nothing appended to the prompt).
assert.equal(
  agentLoopSummaryBlock({
    transcript: [],
    steps: [],
    files: [],
    changedPaths: [],
    rounds: 0,
    converged: true,
  }),
  "",
);

// 8. Read-only work is reported, and no stale-file warning is emitted.
const readOnly = agentLoopSummaryBlock({
  transcript: [],
  steps: [
    { tool: "search_files", label: 'Searched for "Get Started" — 3 matches' },
    { tool: "read_file", label: "Read src/components/Nav.tsx", isError: true },
  ],
  files: [],
  changedPaths: [],
  rounds: 2,
  converged: true,
});
assert.ok(readOnly.includes('Searched for "Get Started" — 3 matches'));
assert.ok(readOnly.includes("(failed)"));
assert.ok(!readOnly.includes("stale"));

// 9. After a codemod the model is told the snapshot is stale for those files
//    and told not to re-edit them — the double-edit guard.
const withCodemod = agentLoopSummaryBlock({
  transcript: [],
  steps: [{ tool: "run_script", label: "Ran script — swap logo (4 files changed)" }],
  files: [],
  changedPaths: ["src/routes/index.tsx", "src/components/Nav.tsx"],
  rounds: 1,
  converged: true,
});
assert.ok(withCodemod.includes("stale"));
assert.ok(withCodemod.includes("src/components/Nav.tsx"));
assert.match(withCodemod, /Do NOT re-edit/);

console.log("agent-loop: all assertions passed");
