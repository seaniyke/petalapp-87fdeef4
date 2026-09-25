import { describe, expect, it } from "vitest";
import { assembleProjectContext, detectSiteCategory, renderDesignKnowledge, selectDesignKnowledge, DESIGN_KNOWLEDGE } from "@/server/context";

const existing = [
  { path: "src/styles.css", content: ":root{--primary: oklch(0.6 0.2 30);--background: oklch(1 0 0);--font-display: 'Fraunces';}" },
  { path: "src/pages/Home.tsx", content: "export default function Home(){return <section className='rounded-xl p-8'><h1>Hi</h1><button className='bg-primary'>Go</button></section>}" },
  { path: "src/App.tsx", content: "import Home from './pages/Home'; export default function App(){return <Home/>}" },
] as never;

describe("design knowledge — category recognition", () => {
  it.each([
    ["Build a SaaS platform for invoices", "saas"],
    ["An agency website for our studio", "agency"],
    ["My portfolio", "portfolio"],
    ["Online store for sneakers with cart", "ecommerce"],
    ["Coffee shop website with menu", "restaurant"],
    ["Boutique hotel site", "hospitality"],
    ["Fintech wallet app", "finance"],
    ["Admin dashboard with analytics", "dashboard"],
    ["Airbnb clone", "marketplace"],
    ["Appointment booking for a salon", "booking"],
    ["A magazine blog", "editorial"],
    ["Waitlist for my startup", "startup"],
    ["A landing page", "landing"],
    ["A habit tracker web app", "webapp"],
  ])("%s → %s", (req, cat) => expect(detectSiteCategory(req)).toBe(cat));
});

describe("design knowledge — conditional loading", () => {
  it("covers every required topic structurally", () => {
    expect(Object.keys(DESIGN_KNOWLEDGE)).toHaveLength(25);
  });
  it("new project loads base + category topics, never everything", () => {
    const s = selectDesignKnowledge({ request: "Build a restaurant website", isInitial: true, hasExistingDesign: false });
    expect(s.mode).toBe("initial");
    expect(s.category).toBe("restaurant");
    expect(s.topics).toContain("imagery");
    expect(s.topics).not.toContain("tables");
    expect(s.topics.length).toBeLessThan(15);
  });
  it("localized edit loads only the topics named, and preserves existing design", () => {
    const s = selectDesignKnowledge({ request: "Make the hero button bigger", isInitial: false, hasExistingDesign: true });
    expect(s.mode).toBe("edit");
    expect(s.preserveExisting).toBe(true);
    expect(s.category).toBeNull();
    expect(s.topics).toEqual(expect.arrayContaining(["hero", "buttons"]));
    expect(s.topics).not.toContain("color");
    expect(s.topics).not.toContain("navigation");
  });
  it("edit with no design words loads no knowledge at all", () => {
    const s = selectDesignKnowledge({ request: "Fix the typo in the footer paragraph", isInitial: false, hasExistingDesign: true });
    expect(renderDesignKnowledge(s)).toBe("");
  });
  it("explicit redesign unlocks category defaults", () => {
    const s = selectDesignKnowledge({ request: "Redesign the whole coffee shop site", isInitial: false, hasExistingDesign: true });
    expect(s.mode).toBe("redesign");
    expect(s.preserveExisting).toBe(false);
    expect(s.category).toBe("restaurant");
  });
  it("user style instructions override category defaults", () => {
    const text = renderDesignKnowledge(selectDesignKnowledge({ request: "Dark minimal hotel website", isInitial: true, hasExistingDesign: false }));
    expect(text).toMatch(/user's stated style wins/);
  });
  it("never forces extra pages or sections", () => {
    const text = renderDesignKnowledge(selectDesignKnowledge({ request: "A SaaS landing page", isInitial: true, hasExistingDesign: false }));
    expect(text).toMatch(/do not add About\/Pricing\/Contact/);
    expect(text).not.toMatch(/must include (an? )?(about|pricing|contact)/i);
  });
});

describe("design knowledge — edit preservation in assembled context", () => {
  it("keeps project design language separate from and above knowledge", () => {
    const ctx = assembleProjectContext({ files: existing, request: "Make the button rounder", isInitial: false, memoryEntries: [] });
    expect(ctx.designKnowledge.preserveExisting).toBe(true);
    expect(ctx.designKnowledgeBlock).toMatch(/PROJECT DESIGN LANGUAGE above > this reference/);
    expect(ctx.designKnowledgeBlock).toMatch(/Do not restyle/);
    expect(ctx.designKnowledgeBlock).not.toMatch(/Recognised intent/);
  });
  it("first build gets category-led knowledge and no project design block", () => {
    const ctx = assembleProjectContext({ files: [] as never, request: "Build an ecommerce store", isInitial: true, memoryEntries: [] });
    expect(ctx.designBlock).toBe("");
    expect(ctx.designKnowledgeBlock).toMatch(/Recognised intent: ecommerce/);
  });
});
