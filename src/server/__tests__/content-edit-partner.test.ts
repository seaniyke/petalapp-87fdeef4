import { describe, expect, it } from "vitest";
import {
  deterministicContentOps,
  isContentOnlyEdit,
  mergeContentOps,
  planContentEdit,
  salvageCompleteOps,
} from "../content-edit.server";

const MAMA_KAY =
  'Rename the restaurant to Mamakayz Conclave & Restaurant everywhere, replacing "Mama Kay\'s Conclave Restaurant". Remove Event planning and Hospitality consulting from every page and data file; keep Outdoor catering. Add Any meal with turkey and snail at ₦14,000 to the menu list, next to the other meals. Show the phone number +234 903 492 1189 in the contact section and footer, with a WhatsApp button linking to https://wa.me/2349034921189.';

const files = [
  { path: "index.html", content: "<title>Mama Kay's Conclave Restaurant</title>" },
  {
    path: "src/data/services.ts",
    content: [
      "export const services = [",
      '  "Outdoor catering",',
      '  "Event planning",',
      "  {",
      '    name: "Hospitality consulting",',
      '    blurb: "Advice",',
      "  },",
      "];",
      'export const brand = "Mama Kay\'s Conclave Restaurant";',
      'export const menu = [{ name: "Jollof", price: "₦5,000" }];',
    ].join("\n"),
  },
];

describe("partner content edits", () => {
  it("counts the Mama Kay request as a content edit", () => {
    expect(isContentOnlyEdit(MAMA_KAY)).toBe(true);
  });

  it("still counts it when followed by standing build rules about backend data", () => {
    const prompt = `# The change\n${MAMA_KAY}\n\n# Build rules\nEvery page in the same style. No calls to /api/public/shared — backend data stays as is.`;
    expect(isContentOnlyEdit(prompt)).toBe(true);
  });

  it("still treats a real colour change as a design edit", () => {
    expect(isContentOnlyEdit("# The change\nChange the colours to green and rename the menu.")).toBe(false);
  });

  it("applies the rename and both removals directly, keeping Outdoor catering", () => {
    const plan = planContentEdit(MAMA_KAY, files)!;
    const det = deterministicContentOps(MAMA_KAY, files, plan);
    const merged = mergeContentOps(det.ops, [], files);
    let data = files[1].content;
    for (const op of merged.ops) if (op.op === "replace" && op.path === files[1].path) data = data.replace(op.search, op.replace);
    expect(data).not.toContain("Event planning");
    expect(data).not.toContain("Hospitality consulting");
    expect(data).toContain("Outdoor catering");
    expect(data).toContain("Mamakayz Conclave & Restaurant");
  });

  it("keeps complete ops from a cut-off answer", () => {
    const raw = '{"ops":[{"op":"replace","path":"a.ts","search":"x","replace":"y"},{"op":"replace","path":"b.ts","sea';
    expect(salvageCompleteOps(raw)).toEqual([{ op: "replace", path: "a.ts", search: "x", replace: "y" }]);
  });
});
