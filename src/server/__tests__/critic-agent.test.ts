import { describe, it, expect } from "vitest";
import { findDeterministicDefects, criticDisclosure } from "@/server/critic-agent.server";
import type { FileOp, ProjectFile } from "@/server/generate.server";

const files: ProjectFile[] = [
  { path: "src/App.tsx", content: Array.from({ length: 120 }, (_, i) => `const x${i} = ${i};`).join("\n") },
  { path: "src/Small.tsx", content: "export const a = 1;\n" },
];

describe("critic deterministic layer", () => {
  it("blocks elision placeholders", () => {
    const ops: FileOp[] = [
      { op: "update", path: "src/App.tsx", content: "import React from 'react';\n// ... rest of the file unchanged" },
    ];
    expect(findDeterministicDefects(ops, files, "make the header blue")).toHaveLength(1);
  });

  it("blocks no-op replaces and blank writes", () => {
    const ops: FileOp[] = [
      { op: "replace", path: "src/Small.tsx", search: "a = 1", replace: "a = 1" },
      { op: "update", path: "src/Small.tsx", content: "   \n" },
    ];
    expect(findDeterministicDefects(ops, files, "tweak")).toHaveLength(2);
  });

  it("blocks entry-file deletes unless asked", () => {
    const ops: FileOp[] = [{ op: "delete", path: "src/App.tsx" }];
    expect(findDeterministicDefects(ops, files, "add a footer")).toHaveLength(1);
    expect(findDeterministicDefects(ops, files, "delete src/App.tsx")).toHaveLength(0);
  });

  it("blocks catastrophic shrink but allows requested rewrites", () => {
    const ops: FileOp[] = [{ op: "update", path: "src/App.tsx", content: "export default () => null;" }];
    expect(findDeterministicDefects(ops, files, "add a footer")).toHaveLength(1);
    expect(findDeterministicDefects(ops, files, "simplify App.tsx")).toHaveLength(0);
  });

  it("approves an ordinary edit", () => {
    const ops: FileOp[] = [
      { op: "replace", path: "src/Small.tsx", search: "a = 1", replace: "a = 2" },
    ];
    expect(findDeterministicDefects(ops, files, "bump a")).toHaveLength(0);
  });

  it("renders a disclosure only when there are rejections", () => {
    expect(criticDisclosure([])).toBe("");
    expect(
      criticDisclosure([{ path: "src/App.tsx", op: "update", reason: "truncated", deterministic: true }]),
    ).toContain("src/App.tsx");
  });
});
