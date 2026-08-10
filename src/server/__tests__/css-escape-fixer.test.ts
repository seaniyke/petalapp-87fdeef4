import { describe, expect, it } from "vitest";
import { fixCssEscapes } from "@/server/css-escape-fixer.server";

function repair(css: string): string {
  const result = fixCssEscapes([{ path: "src/styles.css", content: css }]);
  return result.files[0]?.content ?? "";
}

describe("Tailwind v4 utility-name repair", () => {
  it("strips selector syntax from a simple utility name", () => {
    expect(repair("@utility .tabular-nums { font-variant-numeric: tabular-nums; }")).toBe(
      "@utility tabular-nums { font-variant-numeric: tabular-nums; }",
    );
  });

  it("turns pseudo-selectors into valid plain CSS", () => {
    expect(repair("@utility card:hover { transform: translateY(-1px); }")).toBe(
      ".card:hover { transform: translateY(-1px); }",
    );
    expect(repair("@utility &::after { content: ''; }")).toBe(
      ".custom::after { content: ''; }",
    );
  });

  it("preserves nested braces while repairing the outer rule", () => {
    expect(repair("@utility .grain::after { @media (hover: hover) { opacity: .8; } }")).toBe(
      ".grain::after { @media (hover: hover) { opacity: .8; } }",
    );
  });
});