import { describe, it, expect } from "vitest";
import {
  executeAgentTool,
  applyToolChanges,
  allAgentTools,
} from "@/server/agent-tools.server";

const files = [
  { path: "src/routes/index.tsx", content: 'export default function Home() {\n  return <h1>Build your App in Days.</h1>;\n}\n' },
  { path: "src/components/Hero.tsx", content: "export function Hero() {\n  return <section>Hero</section>;\n}\n" },
  { path: "src/components/ui/button.tsx", content: "export const Button = () => null;\n" },
  { path: "package.json", content: '{"name":"demo"}\n' },
];

const run = (name: string, args: Record<string, unknown>) =>
  executeAgentTool({ call: { name, args }, files, projectId: "p1", readOnly: true });

describe("agent tools", () => {
  it("lists the project root at depth 1", async () => {
    const res = await run("list_dir", { path: "" });
    expect(res.output).toContain("package.json");
    expect(res.output).toContain("src/");
    expect(res.isError).toBeFalsy();
  });

  it("lists a nested directory", async () => {
    const res = await run("list_dir", { path: "src/components", depth: 1 });
    expect(res.output).toContain("Hero.tsx");
    expect(res.output).toContain("ui/");
  });

  it("reads a file with line numbers", async () => {
    const res = await run("read_file", { path: "src/components/Hero.tsx" });
    expect(res.output).toContain("1: export function Hero()");
  });

  it("reads a line range", async () => {
    const res = await run("read_file", { path: "src/routes/index.tsx", start_line: 2, end_line: 2 });
    expect(res.output).toContain("2:");
    expect(res.output).not.toContain("1: export default");
  });

  it("suggests near-misses when a path is wrong", async () => {
    const res = await run("read_file", { path: "src/Hero.tsx" });
    expect(res.isError).toBe(true);
    expect(res.output).toContain("src/components/Hero.tsx");
  });

  it("finds literal UI copy with file and line", async () => {
    const res = await run("search_files", { query: "Build your App in Days." });
    expect(res.output).toContain("src/routes/index.tsx:2");
  });

  it("treats a literal query with regex metacharacters literally", async () => {
    const res = await run("search_files", { query: "Days." });
    expect(res.output).toContain("src/routes/index.tsx");
  });

  it("honours the glob filter", async () => {
    const res = await run("search_files", { query: "export", glob: "src/components" });
    expect(res.output).not.toContain("src/routes/index.tsx");
    expect(res.output).toContain("src/components/Hero.tsx");
  });

  it("reports no matches cleanly", async () => {
    const res = await run("search_files", { query: "zzz-not-here" });
    expect(res.output).toContain("No matches");
    expect(res.isError).toBeFalsy();
  });

  it("blocks run_script for read-only agents", async () => {
    const res = await run("run_script", { runtime: "node", script: "x", purpose: "p" });
    expect(res.isError).toBe(true);
    expect(res.output).toContain("read-only");
  });

  it("rejects unknown tools with the available list", async () => {
    const res = await run("delete_everything", {});
    expect(res.isError).toBe(true);
    expect(res.output).toContain("search_files");
  });

  it("always exposes the read-only trio", () => {
    const names = allAgentTools().map((t) => t.function.name);
    expect(names).toContain("list_dir");
    expect(names).toContain("read_file");
    expect(names).toContain("search_files");
    expect(names).toContain("run_check");
  });
});

describe("applyToolChanges", () => {
  it("applies edits and reports only real changes", () => {
    const out = applyToolChanges(files, [
      { path: "src/components/Hero.tsx", content: "changed\n" },
      { path: "package.json", content: '{"name":"demo"}\n' }, // identical — ignored
      { path: "src/components/New.tsx", content: "new\n" },
    ]);
    expect(out.changedPaths.sort()).toEqual(["src/components/Hero.tsx", "src/components/New.tsx"]);
    expect(out.files.find((f) => f.path === "src/components/Hero.tsx")?.content).toBe("changed\n");
  });

  it("removes deleted paths", () => {
    const out = applyToolChanges(files, [], ["src/components/Hero.tsx"]);
    expect(out.files.some((f) => f.path === "src/components/Hero.tsx")).toBe(false);
    expect(out.changedPaths).toContain("src/components/Hero.tsx");
  });

  it("never mutates the input array", () => {
    const before = JSON.stringify(files);
    applyToolChanges(files, [{ path: "package.json", content: "{}\n" }]);
    expect(JSON.stringify(files)).toBe(before);
  });
});
