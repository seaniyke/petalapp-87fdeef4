import { describe, expect, it } from "vitest";
import {
  LOADED_KNOWLEDGE_FILES,
  filterWebbyOnly,
  loadColorGuide,
  loadCoreKnowledge,
  loadSkillKnowledge,
} from "@/server/agent-knowledge";
import { renderSkillsForTurn, selectSkills } from "@/server/skills";
import { applyContextBudget, budgetMessages, selectHistoryForGeneration } from "@/server/context/budget";
import { SYSTEM_PROMPT_INITIAL, SYSTEM_PROMPT_PATCH } from "@/server/generate.server";
import { readFileSync } from "node:fs";

const base = { scope: "targeted" as const, dimensions: [] as string[], text: "", isInitial: false, isCrossCutting: false };
const generateSrc = readFileSync("src/routes/api/generate.ts", "utf8");

describe("agent knowledge loader", () => {
  it("loads system.md for first builds and compact.md otherwise — never both", () => {
    const full = loadCoreKnowledge("full");
    const compact = loadCoreKnowledge("compact");
    expect(full.file).toBe("system.md");
    expect(compact.file).toBe("compact.md");
    expect(full.text).toContain("USER INTENT IS THE HIGHEST AUTHORITY");
    expect(full.text).toContain("MOBILE-FIRST RESPONSIVE DESIGN");
    expect(compact.text).toContain("USER INTENT WINS");
    expect(compact.text).not.toContain("MOBILE-FIRST RESPONSIVE DESIGN");
    expect(generateSrc).toMatch(/loadCoreKnowledge\(isInitial \? "full" : "compact"\)/);
  });

  it("strips Webby-only tool loops and template placeholders", () => {
    for (const t of [loadCoreKnowledge("full").text, loadCoreKnowledge("compact").text]) {
      expect(t).not.toMatch(/\{\{/);
      expect(t).not.toMatch(/readFile\("template\.json"\)/);
      expect(t).not.toMatch(/MANDATORY PAGE CREATION WORKFLOW|## Tools \(Use|When to Use analyzeProject|Data Persistence with Supabase/);
      expect(t).not.toMatch(/## (TEMPLATE SELECTION|MANDATORY FIRST STEPS|Response Format)/i);
    }
  });

  it("puts Petal runtime and the current request above the manual", () => {
    expect(loadCoreKnowledge("full").text).toMatch(/Precedence: Petal's runtime rules.*then the user's CURRENT request.*then this manual/s);
    const i = generateSrc.indexOf("const staticPrefixText");
    const seg = generateSrc.slice(i, i + 800);
    expect(seg.indexOf("baseSystem")).toBeLessThan(seg.indexOf("coreKnowledge.text"));
  });

  it("never bundles Shopify or WordPress instructions", () => {
    expect(LOADED_KNOWLEDGE_FILES.join(" ")).not.toMatch(/shopify|wordpress/i);
    const loader = readFileSync("src/server/agent-knowledge/index.ts", "utf8");
    expect(loader).not.toMatch(/import .*(shopify|wordpress|platform\/)/i);
  });

  it("filter drops a heading's whole section only", () => {
    const md = "## Keep\na\n## Tools (Use in This EXACT Order)\nb\n### sub\nc\n## Keep 2\nd\n{{INJECT:x}}";
    expect(filterWebbyOnly(md)).toBe("## Keep\na\n## Keep 2\nd");
  });

  it("loads every skill file", () => {
    for (const id of ["copy-and-verify", "motion", "page-composition", "redesign-safety", "section-architectures"] as const) {
      expect(loadSkillKnowledge(id).length).toBeGreaterThan(500);
      expect(loadSkillKnowledge(id)).not.toMatch(/^---/);
    }
    expect(loadColorGuide().length).toBeGreaterThan(500);
  });
});

describe("skill selection uses the Markdown", () => {
  it("first website build loads several relevant skills", () => {
    const ids = selectSkills({ ...base, isInitial: true, scope: "structural", text: "build a landing page for my bakery" }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["page-composition", "section-architectures", "copy-honesty"]));
    expect(ids).not.toContain("redesign-safety");
  });
  it("ordinary edit gets redesign-safety", () => {
    const r = renderSkillsForTurn({ ...base, text: "fix the footer link" });
    expect(r.ids[0]).toBe("redesign-safety");
    expect(r.text).toContain(loadSkillKnowledge("redesign-safety").slice(0, 60));
  });
  it("motion request gets motion.md", () => {
    const r = renderSkillsForTurn({ ...base, text: "add a fade animation to the cards" });
    expect(r.ids).toContain("motion");
    expect(r.text).toContain(loadSkillKnowledge("motion").slice(0, 60));
  });
  it("copy request gets copy-and-verify", () => {
    expect(selectSkills({ ...base, text: "rewrite the headline copy" }).map((s) => s.id)).toContain("copy-honesty");
  });
  it("redesign gets composition and sections", () => {
    const ids = selectSkills({ ...base, scope: "structural", isCrossCutting: true, text: "redesign the whole site" }).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["redesign-safety", "page-composition", "section-architectures"]));
  });
  it("skills are dropped as a unit when over the context budget", () => {
    const skills = renderSkillsForTurn({ ...base, isInitial: true, scope: "structural", text: "landing page" }).text;
    const r = applyContextBudget(
      [
        { id: "system", priority: "required", text: "x".repeat(4000) },
        { id: "skills", priority: "skills", text: skills },
      ],
      1200,
    );
    expect(r.dropped).toContain("skills");
  });
  it("user intent line leads the skills block", () => {
    expect(renderSkillsForTurn({ ...base, text: "change the colour" }).text).toMatch(/current request outranks every default/);
  });
});

describe("duplicates and contradictions removed", () => {
  it("old TS prompt blocks are no longer injected", () => {
    expect(generateSrc).not.toMatch(/designQualityBlock|COPY_CONTRACT_BLOCK|COMPOSITION_CONTRACT_BLOCK|renderLandingChecklistBlock/);
    expect(SYSTEM_PROMPT_INITIAL).not.toMatch(/COMPLETE LANDING PAGE/);
  });
  it("fake testimonials are no longer permitted anywhere in the prompt", () => {
    for (const p of [SYSTEM_PROMPT_INITIAL, SYSTEM_PROMPT_PATCH, readFileSync("src/server/dynamic-prompts.server.ts", "utf8")]) {
      expect(p).not.toMatch(/fake (user )?testimonial/i);
      expect(p).not.toMatch(/pravatar OK/i);
    }
    expect(SYSTEM_PROMPT_INITIAL).toMatch(/Never fabricate testimonials/);
  });
});

describe("multi-turn constraints survive", () => {
  it("earlier constraint messages are kept before budgeting", () => {
    const msgs = [
      { role: "user" as const, content: "Never use purple anywhere, our brand is green." },
      { role: "assistant" as const, content: "Done." },
      { role: "user" as const, content: "Build a pricing page" },
      { role: "assistant" as const, content: "Done." },
      { role: "user" as const, content: "Add a FAQ section" },
    ];
    const kept = selectHistoryForGeneration(msgs, 4, false);
    expect(kept.map((m) => m.content)).toEqual(["Never use purple anywhere, our brand is green.", "Add a FAQ section"]);
    const fitted = budgetMessages([{ role: "system" as const, content: "sys" }, ...kept], 100_000);
    expect(fitted.messages.some((m) => String(m.content).includes("Never use purple"))).toBe(true);
  });
  it("bare confirmations keep their immediate context", () => {
    const msgs = [
      { role: "user" as const, content: "Add a blog" },
      { role: "assistant" as const, content: "Want comments too?" },
      { role: "user" as const, content: "yes" },
    ];
    expect(selectHistoryForGeneration(msgs, 2, true)).toHaveLength(3);
  });
});
