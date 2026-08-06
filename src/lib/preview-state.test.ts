import { describe, expect, it } from "vitest";
import { classifyDevServerFailure, resolvePreviewState, type PreviewStateInput } from "./preview-state";

const base: PreviewStateInput = {
  phase: "booting",
  serverUrl: null,
  instantSrc: null,
  instantDead: false,
  refusedReason: null,
  refusedUrl: null,
  crashReason: null,
  error: null,
};

describe("resolvePreviewState", () => {
  it("prefers the live sandbox over the last deployment", () => {
    const s = resolvePreviewState({ ...base, phase: "ready", serverUrl: "http://live", instantSrc: "http://cdn" });
    expect(s.kind).toBe("live");
    expect(s.src).toBe("http://live");
  });

  it("shows the last deployment with a warming badge while booting", () => {
    const s = resolvePreviewState({ ...base, instantSrc: "http://cdn" });
    expect(s.kind).toBe("last_deployed");
    expect(s.warming).toBe(true);
  });

  it("stops promising warming once the sandbox failed", () => {
    const s = resolvePreviewState({ ...base, phase: "error", instantSrc: "http://cdn" });
    expect(s.warming).toBe(false);
    expect(s.canRetry).toBe(true);
  });

  it("explains framing refusal and offers an external escape hatch", () => {
    const s = resolvePreviewState({ ...base, refusedUrl: "http://cdn", refusedReason: "x_frame_options" });
    expect(s.kind).toBe("refused");
    expect(s.canOpenExternally).toBe(true);
    expect(s.detail).toMatch(/embedded/i);
  });

  it("crash beats every other renderable state", () => {
    const s = resolvePreviewState({ ...base, serverUrl: "http://live", crashReason: "boom" });
    expect(s.kind).toBe("crashed");
  });

  it("admits slowness instead of spinning silently", () => {
    const s = resolvePreviewState({ ...base, elapsedSec: 120 });
    expect(s.kind).toBe("timed_out");
  });
});

describe("classifyDevServerFailure", () => {
  it("ignores warnings", () => {
    expect(classifyDevServerFailure("warning: deprecated API")).toBeNull();
  });
  it("names a missing package", () => {
    expect(classifyDevServerFailure("Failed to resolve import \"zustand\" from src/app.tsx")).toContain("zustand");
  });
  it("catches syntax errors", () => {
    expect(classifyDevServerFailure("SyntaxError: Unexpected token '<'")).toMatch(/parse/i);
  });
});
