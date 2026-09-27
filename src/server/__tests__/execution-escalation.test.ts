import { describe, it, expect } from "vitest";
import { assessExecution, assessPageComplexity } from "@/server/execution";
import { applyPatches } from "@/server/engine/repair";
import { parseRawFiles } from "@/server/engine/raw-file";
import { missingSections, decomposedPageInstruction, targetOf } from "@/server/engine/write";

const base = { isInitial: false, request: "", requirementCount: 1, plannedPages: 0, existingFiles: 10, crossCutting: false, backendInvolved: false, integrations: 0 };

describe("execution complexity", () => {
  it("micro edit is SIMPLE, hospital first build is HEAVY+", () => {
    expect(assessExecution({ ...base, operation: "content_change" }).class).toBe("SIMPLE");
    const h = assessExecution({ ...base, isInitial: true, request: "Build a compliant hospital management system with patient records dashboard", requirementCount: 8, plannedPages: 5, backendInvolved: true });
    expect(["HEAVY", "COMPLEX"]).toContain(h.class);
  });
  it("a constraint escalates", () => {
    expect(assessExecution({ ...base, escalations: ["output_limit"] }).class).toBe("ESCALATED");
  });
  it("simple pages stay whole; truncated pages decompose", () => {
    const p = { route: "/about", file: "src/pages/About.tsx", request: "hospital dashboard", requirementCount: 8, pageCount: 5 };
    expect(assessPageComplexity(p).decompose).toBe(false);
    expect(assessPageComplexity({ ...p, truncatedBefore: true }).decompose).toBe(true);
  });
});

describe("decomposed page output", () => {
  it("keeps closed blocks and drops a cut-off one", () => {
    const t = "```tsx\n// file: src/pages/Home.tsx\nexport default 1\n```\n```tsx\n// file: src/components/home/A.tsx\nexport function A(){}\n```\n```tsx\n// file: src/components/home/B.tsx\nexport function B(";
    expect(parseRawFiles(t).map((f) => f.path)).toEqual(["src/pages/Home.tsx", "src/components/home/A.tsx"]);
  });
  it("finds sections the shell imports but that are missing", () => {
    const files = [
      { path: "src/pages/Home.tsx", content: 'import { A } from "@/components/home/A";\nimport { B } from "@/components/home/B";' },
      { path: "src/components/home/A.tsx", content: "export function A(){}" },
    ];
    expect(missingSections(files, "src/pages/Home.tsx", "src/components/home")).toEqual(["src/components/home/B.tsx"]);
  });
  it("decomposed instruction targets the page file", () => {
    const i = decomposedPageInstruction({ route: "/", file: "src/pages/Home.tsx" }, { decompose: true, reasons: [], sectionDir: "src/components/home" }, []);
    expect(targetOf(i)).toBe("src/pages/Home.tsx");
  });
});

describe("targeted repair", () => {
  it("applies an exact unique patch", () => {
    const r = "<<<<<<< SEARCH\nconst a = mode;\n=======\nconst [mode] = useState(0);\nconst a = mode;\n>>>>>>> REPLACE";
    expect(applyPatches("x\nconst a = mode;\ny", r)).toContain("useState");
  });
  it("rejects a patch that doesn't match", () => {
    expect(applyPatches("x", "<<<<<<< SEARCH\nnope\n=======\nz\n>>>>>>> REPLACE")).toBeNull();
  });
});

