import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { firstBuildBrief, firstBuildSeedFiles, FIRST_BUILD_TOOL_NOTE } from "@/server/engine/first-build";
import { planFirstBuild } from "@/server/engine/plan";

const gen = readFileSync("src/routes/api/generate.ts", "utf8");

describe("first build enters the tool loop directly", () => {
  it("A: no monolithic generation request is sent for first builds", () => {
    // The only pre-loop generation request is guarded off for isInitial.
    expect(gen).toMatch(/const upstream = isInitial \|\| directLogoEdit \? null : await aiChatCompletions\(/);
    // The first-build collected payload is synthetic (no model stream).
    expect(gen).toMatch(/let collected: ParsedTool = isInitial\s*\?\s*\{\s*name: "write_project",\s*args: JSON\.stringify\(\{ files: firstBuildSeedFiles/);
    // The WRITE stage runs for every first build, not only when a draft exists.
    expect(gen).toMatch(/\n\s*if \(isInitial\) \{\n\s*const \{ targetOf: wantOf/);
    expect(gen).not.toMatch(/isInitial && parsed\.files\?\.length/);
  });

  it("B: no fallback route back to the old generator after a loop failure", () => {
    // Chunked generation and the small-chunk / deterministic fallbacks are edit-only.
    expect(gen).toMatch(/if \(chunkAssessment\.needed && !isInitial\)/);
    expect(gen).toMatch(/if \(!isInitial && firstWasTruncated && recovery\.take\("truncated_output"\)\)/);
    // A loop failure is rethrown for first builds, never swallowed into another path.
    expect(gen).toMatch(/if \(isInitial \|\| abortSignal\.aborted\) throw chunkErr;/);
  });

  it("D: the plan carries no shell-only instruction and the brief never claims a draft", () => {
    const p = planFirstBuild({ prompt: "Pages: Home, Menu, About, Contact.", plannedRoutes: [], maxOutputTokens: 10_000 });
    expect("instruction" in p).toBe(false);
    const brief = firstBuildBrief("Build a bakery site", p.pages, []);
    expect(brief).not.toMatch(/first draft/i);
    expect(brief).toMatch(/workspace is empty/);
    expect(brief).toContain("src/pages/Contact.tsx");
    expect(FIRST_BUILD_TOOL_NOTE).toMatch(/NO write_project tool/);
  });

  it("resume seeds only the saved checkpoint files", () => {
    expect(firstBuildSeedFiles(undefined)).toEqual([]);
    expect(firstBuildSeedFiles("not json")).toEqual([]);
    expect(firstBuildSeedFiles(JSON.stringify({ files: [{ path: "a.ts", content: "x" }, { path: 1 }] }))).toEqual([{ path: "a.ts", content: "x" }]);
    expect(firstBuildBrief("x", [], ["a.ts"])).toMatch(/Do not rewrite them/);
  });

  it("E: simple edits never enter first-build machinery", () => {
    expect(gen).toMatch(/const directLogoEdit = !isInitial &&/);
    expect(gen).not.toMatch(/shellInstruction/);
  });
});
