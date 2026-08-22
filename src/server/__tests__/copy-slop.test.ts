import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findCopySlop, findCopySlopIssues, extractVisibleText } from "@/server/copy-slop.server";

describe("copy slop scanner", () => {
  it("flags hype filler in visible copy", () => {
    const src = `export const A = () => <h1>Unleash the power of your workflow</h1>;`;
    const hits = findCopySlop(src);
    expect(hits.map((h) => h.phrase.toLowerCase())).toContain("unleash the power");
  });

  it("flags invented social proof and placeholders", () => {
    const src = `
      const items = ["Trusted by thousands of teams", "Feature One", "hello@example.com"];
      export const B = () => <p>Contact John Doe</p>;
    `;
    const phrases = findCopySlop(src).map((h) => h.phrase.toLowerCase());
    expect(phrases).toContain("trusted by thousands");
    expect(phrases).toContain("feature one");
    expect(phrases).toContain("hello@example.com");
    expect(phrases).toContain("john doe");
  });

  it("ignores identifiers, imports and comments", () => {
    const src = `
      // never write "cutting-edge" in copy
      import { FeatureOne } from "./FeatureOne";
      const todo = 1;
      export const C = () => <FeatureOne count={todo} />;
    `;
    expect(findCopySlop(src)).toHaveLength(0);
  });

  it("accepts concrete, product-specific copy", () => {
    const src = `export const D = () => (
      <section>
        <h1>Build it. Ship it. Then sell it.</h1>
        <p>Describe a web app and Petal builds the real files, then lists it for sale.</p>
      </section>
    );`;
    expect(findCopySlop(src)).toHaveLength(0);
  });

  it("reports one issue per offending file", () => {
    const issues = findCopySlopIssues([
      { path: "src/routes/index.tsx", content: `<h1>Elevate your business today</h1>` },
      { path: "src/lib/util.ts", content: `const s = "Elevate your business";` },
      { path: "src/routes/clean.tsx", content: `<h1>Track your cycle in three taps</h1>` },
    ] as never);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("src/routes/index.tsx");
    expect(issues[0]!.detail).toContain("copy-slop");
  });

  it("extracts JSX text and string literals only", () => {
    const text = extractVisibleText(`<p className="x">Hello there</p>`);
    expect(text).toContain("Hello there");
  });
});

describe("Petal's own marketing copy holds the same contract", () => {
  const files = [
    "src/routes/index.tsx",
    "src/routes/why.$slug.tsx",
    "src/routes/features.$slug.tsx",
    "src/routes/marketplace.tsx",
  ];

  for (const rel of files) {
    it(`${rel} contains no AI filler`, () => {
      let source: string;
      try {
        source = readFileSync(resolve(process.cwd(), rel), "utf8");
      } catch {
        return; // route not present in this checkout — nothing to enforce
      }
      const hits = findCopySlop(source);
      expect(
        hits.map((h) => `${h.phrase} — ${h.guidance}`),
        `slop found in ${rel}`,
      ).toEqual([]);
    });
  }
});
