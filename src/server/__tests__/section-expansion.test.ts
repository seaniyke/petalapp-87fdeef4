import { describe, expect, it } from "vitest";
import { buildSectionExpansionPatch, wantsMoreSections } from "../section-expansion.server";

const MAMA_KAY =
  "Remove Event planning and Hospitality consulting from every page and data file. Add Turkey and snail meal at ₦14,000. Rename the business to Mamakayz. Show +234 903 492 1189 with the WhatsApp link https://wa.me/2349034921189. Edit content where it already lives. Never add a new extra section.";

const page = `import { Hero } from "@/components/Hero";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen">
      <Hero />
      <Footer />
    </main>
  );
}
`;

describe("section expansion fallback", () => {
  it("fires for a plain ask to add sections", () => {
    for (const p of [
      "Add more sections to the homepage",
      "Add more sections to the website",
      "add more sections",
      "can you expand the landing page with more content",
      "add another section to the app",
    ]) {
      expect(wantsMoreSections(p), p).toBe(true);
    }
  });

  it("never fires for a multi-part content edit (Mama Kay's request)", () => {
    expect(wantsMoreSections(MAMA_KAY)).toBe(false);
    expect(buildSectionExpansionPatch({ currentFiles: [{ path: "src/pages/Home.tsx", content: page }], prompt: MAMA_KAY })).toBeNull();
  });

  it("needs the add word to govern the section word", () => {
    expect(wantsMoreSections("make the header sticky")).toBe(false);
    expect(wantsMoreSections("Add a new menu item to the site")).toBe(false);
    expect(wantsMoreSections("Never add a new extra section")).toBe(false);
    expect(wantsMoreSections("add a pricing section")).toBe(false);
    expect(wantsMoreSections("Add more sections and change the phone number")).toBe(false);
  });

  it("adds sections in their own file with an import and a render call", () => {
    const patch = buildSectionExpansionPatch({
      currentFiles: [{ path: "src/pages/Home.tsx", content: page }],
      prompt: "Add more sections to the website",
    });
    expect(patch).not.toBeNull();
    expect(patch!.ops[0].op).toBe("create");
    expect(patch!.ops.length).toBe(3);
    let out = page;
    for (const op of patch!.ops) {
      if (op.op !== "replace") continue;
      expect(out.split(op.search).length).toBe(2);
      out = out.replace(op.search, op.replace);
    }
    expect(out).toContain('import MoreSections from "@/components/MoreSections";');
    expect(out.indexOf("<MoreSections />")).toBeLessThan(out.indexOf("<Footer />"));
    expect(out.match(/<\/main>/g)!.length).toBe(1);
    // No invented customer reviews.
    expect((patch!.ops[0] as { content: string }).content).not.toMatch(/testimonial/i);
  });

  it("no page to touch → no patch", () => {
    expect(buildSectionExpansionPatch({ currentFiles: [], prompt: "add more sections" })).toBeNull();
  });
});
