import { describe, it, expect } from "vitest";
import { parseRawFile } from "@/server/engine/raw-file";

describe("plain-text page output", () => {
  it("keeps quotes exactly — a raw className=\" can no longer end the file", () => {
    const code = 'export default function Home() {\n  return <h2 className="text-4xl">Hi</h2>;\n}\n';
    expect(parseRawFile("```tsx\n" + code + "```")).toBe(code);
  });
  it("an unclosed block is a cut-off file and is discarded", () => {
    expect(parseRawFile("```tsx\nexport default function Home() {\n  return <h2 className=")).toBeNull();
  });
  it("no block or empty block gives nothing", () => {
    expect(parseRawFile("here is the page")).toBeNull();
    expect(parseRawFile("```tsx\n\n```")).toBeNull();
  });
  it("inner backticks in template strings don't close the block", () => {
    const code = "const a = `x ${1}`;\nexport default a;\n";
    expect(parseRawFile("```tsx\n" + code + "```\n")).toBe(code);
  });
});
