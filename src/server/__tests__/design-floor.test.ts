import { describe, it, expect } from "vitest";
import { STYLES_CSS } from "../scaffold-kit";
import { repairStylesCss, validateStylesCss } from "../validate-styles.server";
import { applyPaletteFloor } from "../palette-floor.server";
import { enforceDesignFinish } from "../design-finisher.server";

describe("stylesheet repair", () => {
  it("keeps multi-line comment continuations intact", () => {
    const repaired = repairStylesCss(STYLES_CSS);
    expect(repaired).not.toBeNull();
    expect(repaired!.css).toContain("--font-sans:");
    expect(repaired!.css).toContain("--font-display:");
    // Every comment opened must be closed — an unterminated comment silently
    // swallows the declarations that follow.
    const opens = (repaired!.css.match(/\/\*/g) ?? []).length;
    const closes = (repaired!.css.match(/\*\//g) ?? []).length;
    expect(opens).toBe(closes);
    expect(validateStylesCss(repaired!.css)).toEqual({ ok: true });
  });
});

describe("palette floor", () => {
  it("replaces the scaffold default palette", () => {
    const out = applyPaletteFloor(STYLES_CSS, "artisan coffee roastery subscription");
    expect(out.changed).toBe(true);
    expect(out.css).not.toContain("--primary: oklch(0.55 0.18 280)");
    expect(out.label).toBeTruthy();
  });

  it("leaves a customised palette alone", () => {
    const custom = STYLES_CSS.replace("--primary: oklch(0.55 0.18 280)", "--primary: #c4654a");
    const out = applyPaletteFloor(custom, "anything");
    expect(out.changed).toBe(false);
    expect(out.css).toBe(custom);
  });
});

describe("design finisher", () => {
  it("does not treat a commented-out font declaration as real", () => {
    const css = `@import "tailwindcss";\n\n/* --font-display: "Ghost"; */\n:root { --primary: #123456; }\n`;
    const out = enforceDesignFinish([
      { path: "src/styles.css", content: css },
      { path: "index.html", content: "<html><head><title>Test</title></head><body></body></html>" },
    ] as never);
    const next = out.files.find((f) => f.path === "src/styles.css")!.content;
    expect(next).toMatch(/--font-display:\s*"(?!Ghost)/);
    expect(next).toContain("petal:type-floor");
  });

  it("replaces a font pointer (var(--font-sans)) with a real family", () => {
    const css = `@import "tailwindcss";\n\n@theme {\n  --font-sans: "Inter", sans-serif;\n  --font-display: var(--font-sans);\n}\n`;
    const out = enforceDesignFinish([{ path: "src/styles.css", content: css }] as never);
    const next = out.files.find((f) => f.path === "src/styles.css")!.content;
    expect(next).not.toContain("--font-display: var(--font-sans)");
  });
});
