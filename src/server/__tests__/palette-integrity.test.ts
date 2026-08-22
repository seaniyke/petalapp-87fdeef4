import { describe, it, expect } from "vitest";
import {
  findPaletteIssues,
  repairPaletteIntegrity,
} from "../palette-integrity.server";
import { sweepTailwindTokens } from "../tailwind-token-sweep.server";

const css = (content: string) => ({ path: "src/styles.css", content });

const GOOD = `@theme {
  --color-primary: var(--primary);
}
:root {
  --background: oklch(0.99 0.01 90);
  --foreground: oklch(0.18 0.02 60);
  --primary: oklch(0.62 0.17 30);
  --primary-foreground: oklch(0.99 0 0);
  --card: oklch(1 0 0);
  --border: oklch(0.9 0.01 60);
  --font-display: "Fraunces", serif;
}
`;

describe("palette integrity", () => {
  it("leaves a healthy stylesheet alone", () => {
    const out = repairPaletteIntegrity([css(GOOD)]);
    expect(out.fixes).toBe(0);
    expect(out.files[0].content).toBe(GOOD);
  });

  it("detects a self-referential declaration", () => {
    const broken = GOOD + `:root { --primary: var(--primary); }\n`;
    const issues = findPaletteIssues([css(broken)]);
    expect(issues.some((i) => i.kind === "circular" && i.token === "primary")).toBe(true);
  });

  it("removes the circular declaration and restores the real colour", () => {
    const broken = GOOD + `:root {\n  --primary: var(--primary);\n}\n`;
    const out = repairPaletteIntegrity([css(broken)]);
    expect(out.fixes).toBeGreaterThan(0);
    expect(out.files[0].content).not.toMatch(/--primary:\s*var\(--primary\)/);
    expect(out.files[0].content).toMatch(/--primary:\s*oklch\(0\.62/);
  });

  it("flags a palette flattened onto --foreground", () => {
    const flat = GOOD + `:root {\n  --card: var(--foreground);\n}\n`;
    const issues = findPaletteIssues([css(flat)]);
    expect(issues.some((i) => i.kind === "flattened" && i.token === "card")).toBe(true);
    expect(repairPaletteIntegrity([css(flat)]).fixes).toBeGreaterThan(0);
  });

  it("flags a declared font that nothing loads", () => {
    const issues = findPaletteIssues([css(GOOD)]);
    expect(issues.some((i) => i.kind === "font-not-loaded")).toBe(true);
  });

  it("accepts a font that is loaded from Google Fonts", () => {
    const issues = findPaletteIssues([
      css(GOOD),
      {
        path: "index.html",
        content: `<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap" rel="stylesheet">`,
      },
    ]);
    expect(issues.some((i) => i.kind === "font-not-loaded")).toBe(false);
  });
});

describe("tailwind token sweep no longer breaks the palette", () => {
  it("does not redeclare tokens that exist as bare vars", () => {
    const app = {
      path: "src/pages/Home.tsx",
      content: `export default () => <div className="bg-primary text-primary-foreground border-border" />;`,
    };
    const out = sweepTailwindTokens([css(GOOD), app]);
    expect(out.addedTokens).not.toContain("primary");
    expect(findPaletteIssues(out.files).some((i) => i.kind === "circular")).toBe(false);
  });

  it("never writes a --font-* value", () => {
    const app = {
      path: "src/pages/Home.tsx",
      content: `export default () => <h1 className="font-display">Hi</h1>;`,
    };
    const out = sweepTailwindTokens([css(GOOD), app]);
    expect(out.files[0].content).toMatch(/--font-display:\s*"Fraunces"/);
    expect(out.addedTokens.every((t) => !t.startsWith("font-"))).toBe(true);
  });

  it("skips injection entirely when the scanner mis-fires", () => {
    const app = {
      path: "src/pages/Home.tsx",
      content: `export default () => <div className="${Array.from({ length: 40 }, (_, i) => `bg-madeup${i}`).join(" ")}" />;`,
    };
    const out = sweepTailwindTokens([css(GOOD), app]);
    expect(out.addedTokens).toHaveLength(0);
    expect(out.files[0].content).toBe(GOOD);
  });
});
