/**
 * Guards the two root causes of the prompt → build flash in the builder.
 * (builder.tsx is a 6k-line route component that can't be mounted without
 * the full app, so these assert the render-order invariants directly.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/routes/builder.tsx"), "utf8");
const sendStart = src.indexOf("const userMsg: ChatMessage = {");
const send = src.slice(sendStart, src.indexOf("let resultFiles: ProjectFile[] | null = null;", sendStart));

describe("prompt → build transition", () => {
  it("resets the previous turn's surface in the same render as busy, before any await", () => {
    const reset = send.indexOf("setActivityVisible(false)");
    const busy = send.indexOf("setBusy(true)");
    const firstAwait = send.indexOf("await ");
    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(busy);
    expect(busy).toBeLessThan(firstAwait);
    // Every stale surface cleared together with it.
    for (const call of ["setStreamingAssistant(\"\")", "setFileChanges({})", "setPhases(defaultPhases())"]) {
      const at = send.indexOf(call);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(busy);
    }
  });

  it("never blocks the user's own message on project naming", () => {
    expect(src).not.toMatch(/await provisionProjectTitle\(/);
  });

  it("message keys survive optimistic → persisted hydration (no id in the key)", () => {
    expect(src).not.toMatch(/key=\{m\.id \?\?/);
  });
});
