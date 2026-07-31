import { describe, it, expect } from "vitest";
import { fixSourceEscapes, unescapeCodePositions } from "../source-escape-fixer.server";

describe("source-escape-fixer", () => {
  it("unescapes literal \\n in code position", () => {
    const src = 'const a = [\n  { name: "Rhys",\\n    role: "Jeweler" },\n];\n';
    const { out, count } = unescapeCodePositions(src);
    expect(count).toBe(1);
    expect(out).not.toContain('",\\n');
    expect(out).toContain('role: "Jeweler"');
  });

  it("leaves escapes inside string literals alone", () => {
    const src = 'const s = "line1\\nline2";\nconst t = `a\\tb`;\n';
    const { out, count } = unescapeCodePositions(src);
    expect(count).toBe(0);
    expect(out).toBe(src);
  });

  it("handles template interpolation returning to code position", () => {
    const src = "const x = `hi ${name}`;\\nconst y = 1;\n";
    const { out, count } = unescapeCodePositions(src);
    expect(count).toBe(1);
    expect(out).toContain("`hi ${name}`;\nconst y = 1;");
  });

  it("only rewrites source files and reports notes", () => {
    const res = fixSourceEscapes([
      { path: "src/A.tsx", content: 'const a = 1;\\nconst b = 2;\n' },
      { path: "README.md", content: "keep \\n here" },
    ]);
    expect(res.notes).toHaveLength(1);
    expect(res.files[0].content).toContain("const a = 1;\nconst b = 2;");
    expect(res.files[1].content).toBe("keep \\n here");
  });
});
