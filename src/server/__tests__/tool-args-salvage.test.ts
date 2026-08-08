import { describe, it, expect } from "vitest";
import {
  salvagePartialToolArgs,
  dropUnusableOps,
  dropUnusableFiles,
} from "@/server/tool-args-salvage.server";

describe("salvagePartialToolArgs", () => {
  it("recovers complete ops from a stream cut off mid-array", () => {
    const raw = `{"plan":"Wire up the pages","summary":"Made the app functional","ops":[
      {"op":"update","path":"src/pages/Home.tsx","content":"a"},
      {"op":"replace","path":"src/App.tsx","search":"x","replace":"y"},
      {"op":"update","path":"src/pages/Cycle`;
    const out = salvagePartialToolArgs(raw, "patch_files");
    expect(out).not.toBeNull();
    expect(out!.recovered).toBe(2);
    expect(out!.truncated).toBe(true);
    expect(out!.parsed["summary"]).toBe("Made the app functional");
    expect(out!.parsed["plan"]).toBe("Wire up the pages");
  });

  it("is not fooled by braces or brackets inside string content", () => {
    const raw = `{"ops":[{"op":"update","path":"a.tsx","content":"const x = { a: [1,2] }; // \\" }"},{"op":"delete","path":"b.tsx"},{"op":"upd`;
    const out = salvagePartialToolArgs(raw, "patch_files");
    expect(out!.recovered).toBe(2);
    expect((out!.parsed["ops"] as Array<{ path: string }>)[1].path).toBe("b.tsx");
  });

  it("recovers files for write_project", () => {
    const raw = `{"files":[{"path":"src/App.tsx","content":"hi"},{"path":"src/main`;
    const out = salvagePartialToolArgs(raw, "write_project");
    expect(out!.recovered).toBe(1);
  });

  it("returns null when nothing complete survived", () => {
    expect(salvagePartialToolArgs(`{"ops":[{"op":"upd`, "patch_files")).toBeNull();
    expect(salvagePartialToolArgs(`{"summary":"nope"}`, "patch_files")).toBeNull();
  });
});

describe("dropUnusableOps", () => {
  it("keeps good ops and drops structurally broken ones", () => {
    const { ops, dropped } = dropUnusableOps([
      { op: "update", path: "a.tsx", content: "x" },
      { op: "replace", path: "b.tsx", search: "", replace: "y" },
      { op: "replace", path: "c.tsx", search: "s", replace: "r" },
      { op: "update", path: "" },
      { op: "delete", path: "d.tsx" },
      { op: "ast-patch", path: "e.tsx", edits: [] },
    ] as Array<Record<string, unknown>>);
    expect(ops.map((o) => o["path"])).toEqual(["a.tsx", "c.tsx", "d.tsx", "e.tsx"]);
    expect(dropped).toBe(2);
  });
});

describe("dropUnusableFiles", () => {
  it("requires a path and string content", () => {
    const { files, dropped } = dropUnusableFiles([
      { path: "a.tsx", content: "x" },
      { path: "b.tsx" },
    ] as Array<Record<string, unknown>>);
    expect(files).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});
