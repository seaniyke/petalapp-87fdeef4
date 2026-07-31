import { strict as assert } from "node:assert";
import {
  executeAgentTool,
  applyToolChanges,
  allAgentTools,
} from "../agent-tools.server";

const files = [
  {
    path: "src/routes/index.tsx",
    content:
      'export default function Home() {\n  return <h1>Build your App in Days.</h1>;\n}\n',
  },
  {
    path: "src/components/Hero.tsx",
    content: "export function Hero() {\n  return <section>Hero</section>;\n}\n",
  },
  { path: "src/components/ui/button.tsx", content: "export const Button = () => null;\n" },
  { path: "package.json", content: '{"name":"demo"}\n' },
];

const run = (name: string, args: Record<string, unknown>) =>
  executeAgentTool({ call: { name, args }, files, projectId: "p1", readOnly: true });

async function main() {
  // 1. list_dir at the root collapses nested paths into directory entries.
  const root = await run("list_dir", { path: "" });
  assert.ok(root.output.includes("package.json"));
  assert.ok(root.output.includes("src/"));
  assert.ok(!root.isError);

  // 2. list_dir into a subtree.
  const comps = await run("list_dir", { path: "src/components" });
  assert.ok(comps.output.includes("Hero.tsx"));
  assert.ok(comps.output.includes("ui/"));

  // 3. read_file returns 1-indexed numbered lines.
  const read = await run("read_file", { path: "src/components/Hero.tsx" });
  assert.ok(read.output.includes("1: export function Hero()"));

  // 4. read_file honours a line range.
  const ranged = await run("read_file", {
    path: "src/routes/index.tsx",
    start_line: 2,
    end_line: 2,
  });
  assert.ok(ranged.output.includes("2:"));
  assert.ok(!ranged.output.includes("1: export default"));

  // 5. A wrong path is an error that suggests real near-misses.
  const missing = await run("read_file", { path: "src/Hero.tsx" });
  assert.equal(missing.isError, true);
  assert.ok(missing.output.includes("src/components/Hero.tsx"));

  // 6. Literal UI copy resolves to file + line — the whole point of the tool.
  const copy = await run("search_files", { query: "Build your App in Days." });
  assert.ok(copy.output.includes("src/routes/index.tsx:2"));

  // 7. Regex metacharacters in a literal query stay literal (no crash, no
  //    accidental wildcard).
  const dotted = await run("search_files", { query: "Days." });
  assert.ok(dotted.output.includes("src/routes/index.tsx"));

  // 8. glob narrows the search.
  const scoped = await run("search_files", { query: "export", glob: "src/components" });
  assert.ok(!scoped.output.includes("src/routes/index.tsx"));
  assert.ok(scoped.output.includes("src/components/Hero.tsx"));

  // 9. No matches is a clean answer, not an error.
  const none = await run("search_files", { query: "zzz-not-here" });
  assert.ok(none.output.includes("No matches"));
  assert.ok(!none.isError);

  // 10. Read-only agents can never run a codemod.
  const blocked = await run("run_script", { runtime: "node", script: "x", purpose: "p" });
  assert.equal(blocked.isError, true);
  assert.ok(blocked.output.includes("read-only"));

  // 11. Unknown tool names fail loudly and list what exists.
  const unknown = await run("delete_everything", {});
  assert.equal(unknown.isError, true);
  assert.ok(unknown.output.includes("search_files"));

  // 12. The read-only surface is always advertised.
  const names = allAgentTools().map((t) => t.function.name);
  for (const n of ["list_dir", "read_file", "search_files", "run_check"]) {
    assert.ok(names.includes(n), `missing tool: ${n}`);
  }

  // 13. applyToolChanges reports only real movement.
  const applied = applyToolChanges(files, [
    { path: "src/components/Hero.tsx", content: "changed\n" },
    { path: "package.json", content: '{"name":"demo"}\n' }, // byte-identical
    { path: "src/components/New.tsx", content: "new\n" },
  ]);
  assert.deepEqual(applied.changedPaths.sort(), [
    "src/components/Hero.tsx",
    "src/components/New.tsx",
  ]);
  assert.equal(
    applied.files.find((f) => f.path === "src/components/Hero.tsx")?.content,
    "changed\n",
  );

  // 14. Deletions are applied and reported.
  const deleted = applyToolChanges(files, [], ["src/components/Hero.tsx"]);
  assert.ok(!deleted.files.some((f) => f.path === "src/components/Hero.tsx"));
  assert.ok(deleted.changedPaths.includes("src/components/Hero.tsx"));

  // 15. The caller's array is never mutated.
  const before = JSON.stringify(files);
  applyToolChanges(files, [{ path: "package.json", content: "{}\n" }]);
  assert.equal(JSON.stringify(files), before);

  console.log("agent-tools: all assertions passed");
}

void main();
