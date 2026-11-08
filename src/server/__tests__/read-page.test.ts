import { describe, expect, it } from "vitest";
import { readPage } from "@/server/engine/tool-loop";

describe("long file reads", () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `const line${i} = ${i};`);
  it("a long file is cut at a whole line and says where to continue", () => {
    const p = readPage(lines, 1, 1000, 12_000);
    expect(p.truncated).toBe(true);
    const shown = Number(/lines 1-(\d+)/.exec(p.text)![1]);
    expect(p.text).toContain(`start_line=${shown + 1}`);
  });
  it("the continued page reaches the end of the file", () => {
    let start = 1;
    let pages = 0;
    for (;;) {
      const p = readPage(lines, start, 1000, 12_000);
      pages++;
      if (!p.truncated) { expect(p.text).toContain("1000: const line999"); break; }
      start = Number(/start_line=(\d+)/.exec(p.text)![1]);
    }
    expect(pages).toBeGreaterThan(1);
  });
  it("a short file is not truncated", () => {
    expect(readPage(lines, 1, 10, 12_000).truncated).toBe(false);
  });
});
