import { describe, expect, it } from "vitest";
import { duplicateChromeFindings } from "../verification/structure";
import { classifyTaskDifficulty, modelForDifficulty, defaultFirstBuildModel, defaultTextModel, isConfiguredModel } from "@/lib/ai-model-config";

const page = (path: string, content: string) => ({ path, content }) as never;

describe("duplicate page chrome guard", () => {
  it("rejects a page that renders its own site header with nav", () => {
    const f = duplicateChromeFindings([page("src/pages/Home.tsx", `<header><nav><a href="/">Home</a></nav></header><section/>`)]);
    expect(f).toHaveLength(1);
  });
  it("rejects an announcement bar inside a page", () => {
    expect(duplicateChromeFindings([page("src/pages/Home.tsx", `<div className="announcement-bar">Sale</div>`)])).toHaveLength(1);
  });
  it("allows page headers without nav, in-page tabs and the shared layout", () => {
    expect(duplicateChromeFindings([
      page("src/pages/Dash.tsx", `<header><h1>Bookings</h1></header><nav aria-label="Tabs"><button/></nav>`),
      page("src/components/Layout.tsx", `<header><nav/></header>`),
    ])).toHaveLength(0);
  });
});

describe("difficulty model routing", () => {
  it("sends site-wide, multi-part and structural work to the frontier model", () => {
    expect(classifyTaskDifficulty({ crossCutting: true })).toBe("hard");
    expect(classifyTaskDifficulty({ multiEdit: true })).toBe("hard");
    expect(classifyTaskDifficulty({ scope: "structural" })).toBe("hard");
    expect(modelForDifficulty("hard")).toBe(defaultFirstBuildModel());
  });
  it("keeps small edits on the fast code model", () => {
    expect(classifyTaskDifficulty({ scope: "micro", promptChars: 40 })).toBe("micro");
    expect(modelForDifficulty("micro")).toBe(defaultTextModel());
    expect(classifyTaskDifficulty({ scope: "micro", promptChars: 900 })).toBe("standard");
    expect(classifyTaskDifficulty({ scope: "targeted", promptChars: 40 })).toBe("standard");
    expect(modelForDifficulty("standard")).toBe(defaultTextModel());
  });
  it("only routes to configured models (never silently coerced)", () => {
    expect(isConfiguredModel(modelForDifficulty("hard"))).toBe(true);
    expect(isConfiguredModel(modelForDifficulty("standard"))).toBe(true);
  });
});
