import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  conversationalFallbackEvents,
  fallbackMayApply,
  noSafeEditOutcome,
} from "../edit-fallback.server";
import { turnOutcomeStatus } from "../engine/build-state";
import {
  diffToReplaceOps,
  isContentOnlyEdit,
  planContentEdit,
  updatesToReplaceOps,
} from "../content-edit.server";
import type { FileOp } from "../generate.server";

const MAMA_KAY =
  "Remove Event planning and Hospitality consulting from every page and data file. Add Turkey and snail meal at ₦14,000. Rename the business to Mamakayz. Show +234 903 492 1189 with the WhatsApp link https://wa.me/2349034921189. Edit content where it already lives. Never add a new extra section.";

describe("an edit that can't be finished fails honestly", () => {
  it("no fallback may stand in for Mama Kay's request", () => {
    expect(fallbackMayApply("section_expansion", MAMA_KAY)).toBe(false);
    expect(fallbackMayApply("brand_mark", MAMA_KAY)).toBe(false);
    expect(fallbackMayApply("hero_background", MAMA_KAY)).toBe(false);
    expect(fallbackMayApply("brand_mark", "Add a logo to the header")).toBe(true);
    expect(fallbackMayApply("hero_background", "Change the hero background to a photo")).toBe(true);
  });

  it("when every recovery fails: outcome failed, no new version, nothing charged", () => {
    const files = [{ path: "src/pages/Home.tsx", content: "export default function Home() { return null; }" }];
    const events = conversationalFallbackEvents({ files, ...noSafeEditOutcome() });
    const outcome = events.find((e) => e.type === "turn_outcome")!;
    const result = events.find((e) => e.type === "result")!;
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toBe("no_safe_edit");
    expect(outcome.changedPaths).toEqual([]);
    expect(result.creditsCharged).toBe(0);
    expect(result.noFileChanges).toBe(true);
    expect(result.files).toBe(files);
    expect(String(result.summary)).toMatch(/nothing on your site was changed/i);
    // The terminal turn status the API reports is "failed", never succeeded.
    expect(turnOutcomeStatus(`data: ${JSON.stringify(outcome)}\n\n`)).toBe("failed");
  });

  it("the generate route ends no_safe_edit as failed, never answered", () => {
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).not.toMatch(/outcome:\s*"answered",\s*\n\s*reason:\s*"no_safe_edit"/);
    expect(src).toMatch(/\.\.\.noSafeEditOutcome\(\)/);
  });
});

describe("content edits patch in place", () => {
  const menu = [
    "export const services = [",
    '  { name: "Jollof rice", price: "₦8,000" },',
    '  { name: "Event planning", price: "₦50,000" },',
    '  { name: "Hospitality consulting", price: "₦40,000" },',
    '  { name: "Pepper soup", price: "₦6,500" },',
    "];",
    "",
    'export const PHONE = "+234 800 000 0000";',
    ...Array.from({ length: 30 }, (_, i) => `export const filler${i} = ${i};`),
  ].join("\n");
  const files = [
    { path: "index.html", content: "<html><head><title>Mama Kay's Kitchen | Lagos</title></head></html>" },
    { path: "src/data/services.ts", content: menu },
    { path: "src/components/Header.tsx", content: "export function Header(){ return <h1>Mama Kay's Kitchen</h1>; }" },
    { path: "src/components/Gallery.tsx", content: "export function Gallery(){ return <div>Photos</div>; }" },
  ];

  it("recognises Mama Kay's request as a content edit and finds where the content lives", () => {
    expect(isContentOnlyEdit(MAMA_KAY)).toBe(true);
    expect(isContentOnlyEdit("Redesign the homepage with a darker theme")).toBe(false);
    const plan = planContentEdit(MAMA_KAY, files)!;
    expect(plan.paths).toContain("src/data/services.ts");
    expect(plan.paths).toContain("src/components/Header.tsx");
    expect(plan.paths).not.toContain("src/components/Gallery.tsx");
    expect(plan.phrases).toEqual(expect.arrayContaining(["Event planning", "Hospitality consulting"]));
    expect(plan.brand).toBe("Mama Kay's Kitchen");
  });

  it("an edit to an existing menu file produces patch ops, not a whole-file rewrite", () => {
    const edited = menu
      .replace('  { name: "Event planning", price: "₦50,000" },\n', "")
      .replace('  { name: "Hospitality consulting", price: "₦40,000" },\n', "")
      .replace('  { name: "Pepper soup", price: "₦6,500" },', '  { name: "Pepper soup", price: "₦6,500" },\n  { name: "Turkey and snail meal", price: "₦14,000" },')
      .replace('"+234 800 000 0000"', '"+234 903 492 1189"');
    const ops: FileOp[] = [{ op: "update", path: "src/data/services.ts", content: edited }];
    const out = updatesToReplaceOps(ops, files);
    expect(out.converted).toEqual(["src/data/services.ts"]);
    expect(out.ops.length).toBeGreaterThan(0);
    expect(out.ops.every((o) => o.op === "replace")).toBe(true);
    let applied = menu;
    for (const o of out.ops) {
      if (o.op !== "replace") continue;
      expect(applied.split(o.search).length).toBe(2);
      applied = applied.replace(o.search, o.replace);
    }
    expect(applied).toBe(edited);
  });

  it("leaves a genuine rewrite alone", () => {
    expect(diffToReplaceOps("a.ts", "a\nb\nc\nd\ne", "v\nw\nx\ny\nz")).toBeNull();
  });
});
