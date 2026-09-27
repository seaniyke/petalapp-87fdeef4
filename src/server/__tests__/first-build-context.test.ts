/**
 * Minimum sufficient context for first builds: tiered knowledge, one source
 * per rule, on-demand retrieval, per-step telemetry.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assembleFirstBuildContext,
  classifyWorkUnit,
  splitPromptBlocks,
  splitMarkdownSections,
  BASE_ALWAYS,
  MANUAL_ALWAYS,
  MANUAL_FIRST_BUILD,
  KNOWLEDGE_DIR,
} from "@/server/engine/first-build-context";
import { SYSTEM_PROMPT_INITIAL } from "@/server/generate.server";
import { loadCoreKnowledge, loadSkillKnowledge } from "@/server/agent-knowledge";
import { FIRST_BUILD_TOOL_NOTE, firstBuildBrief } from "@/server/engine/first-build";
import { TEMPLATE_PRELOADED_RULE } from "@/server/engine/template-contract";
import { runToolLoop, type ModelReply, type ToolCallMsg, type LoopMessage } from "@/server/engine/tool-loop";
import { validateUnitImports } from "@/server/engine/work-unit";
import { codegenProviderRouting } from "@/server/engine/provider-policy";

const SKILL_IDS = ["copy-and-verify", "motion", "page-composition", "redesign-safety", "section-architectures"] as const;
const manual = loadCoreKnowledge("full").text;
const skills = Object.fromEntries(SKILL_IDS.map((id) => [id, loadSkillKnowledge(id)]));
const build = (over: Partial<Parameters<typeof assembleFirstBuildContext>[0]> = {}) =>
  assembleFirstBuildContext({
    knowledge: { basePrompt: SYSTEM_PROMPT_INITIAL, manual, skills, extras: { "Design taste manual": "## Taste\nlong design manual text", "Empty": "" } },
    subtype: "marketing",
    hasBackend: false,
    productContract: { prd: "### Product requirements\n- Home, Menu, About, Contact" },
    projectReference: {},
    toolNote: FIRST_BUILD_TOOL_NOTE,
    ...over,
  });

let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `k${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: calls });

describe("tiered first-build knowledge", () => {
  it("1. the full manual is NOT injected into the first-build system prompt", () => {
    const ctx = build();
    expect(ctx.system).not.toContain(manual);
    expect(ctx.system.length).toBeLessThan(manual.length + SYSTEM_PROMPT_INITIAL.length);
    for (const s of splitMarkdownSections(manual)) {
      const preloaded = [...MANUAL_ALWAYS, ...MANUAL_FIRST_BUILD].some((p) => s.title.toLowerCase().startsWith(p));
      if (!preloaded) expect(ctx.system.includes(s.text), s.title).toBe(false);
    }
  });

  it("2. universal rules stay in context, and every always-on label exists in its source", () => {
    const labels = splitPromptBlocks(SYSTEM_PROMPT_INITIAL).map((b) => b.title.toLowerCase());
    for (const l of BASE_ALWAYS) expect(labels.some((t) => t.startsWith(l.toLowerCase())), l).toBe(true);
    const titles = splitMarkdownSections(manual).map((s) => s.title.toLowerCase());
    for (const l of [...MANUAL_ALWAYS, ...MANUAL_FIRST_BUILD]) expect(titles.some((t) => t.startsWith(l)), l).toBe(true);
    const ctx = build();
    expect(ctx.system).toContain("BRAND IDENTITY");
    expect(ctx.system).toContain("DECLARE-BEFORE-USE");
    expect(ctx.system).toMatch(/USER INTENT IS THE HIGHEST AUTHORITY/);
  });

  it("tool mode never receives write_project-mode contradictions", () => {
    const ctx = build();
    expect(ctx.system).not.toMatch(/ALWAYS respond by calling the "write_project"/);
    expect(ctx.system).not.toMatch(/STYLES\.CSS SAFETY RULES/);
    expect(ctx.system).not.toMatch(/STREAMING NARRATIVE FIELDS/);
    expect(ctx.system).toMatch(/NO write_project tool/);
  });

  it("3. conditional knowledge follows the classified work", () => {
    const site = build({ subtype: "marketing" });
    expect(site.system).toContain("## Skill: page-composition");
    expect(site.tiers.conditional).toContain("skill:page-composition");
    const app = build({ subtype: "app" });
    expect(app.system).not.toContain("## Skill: page-composition");
    expect(app.reference.some((r) => r.path === `${KNOWLEDGE_DIR}/skill-page-composition.md`)).toBe(true);
    expect(build({ hasBackend: true }).system).toContain("BACKEND / AUTH RULES");
    expect(build({ hasBackend: false }).system).toContain("NO-BACKEND AUTH RULE");
    expect(build({ hasBackend: false }).system).not.toContain("BACKEND / AUTH RULES (only");
  });

  it("4. on-demand knowledge is complete, indexed and never lost", () => {
    const ctx = build();
    const paths = ctx.reference.map((r) => r.path);
    expect(paths).toContain(`${KNOWLEDGE_DIR}/skill-motion.md`);
    expect(paths).toContain(`${KNOWLEDGE_DIR}/design-taste-manual.md`);
    expect(paths.some((p) => p.includes("prerequisite-gating"))).toBe(true);
    expect(paths.some((p) => p.includes("empty"))).toBe(false);
    for (const p of paths) expect(ctx.system).toContain(p);
    // Every manual section is either preloaded or retrievable verbatim.
    for (const s of splitMarkdownSections(manual)) {
      const inSystem = ctx.system.includes(s.text);
      const inDocs = ctx.reference.some((r) => r.content.includes(s.text));
      expect(inSystem || inDocs, s.title).toBe(true);
    }
    expect(ctx.reference.find((r) => r.path.endsWith("skill-motion.md"))!.content.trim()).toBe(skills.motion!.trim());
  });

  it("4b. the loop can retrieve an on-demand doc with read_file, and cannot write it", async () => {
    const ctx = build();
    const doc = ctx.reference.find((r) => r.path.endsWith("skill-motion.md"))!;
    const seen: LoopMessage[][] = [];
    const steps = [
      reply(call("read_file", { path: doc.path })),
      reply(call("create_file", { path: doc.path, content: "overwrite" })),
      reply(call("create_file", { path: "src/pages/Home.tsx", content: "export default function Home(){return null}" })),
    ];
    const r = await runToolLoop({
      goal: "g", system: ctx.system, brief: "b", files: [], reference: ctx.reference,
      validate: (f, t) => validateUnitImports(f, t).map((d) => d.message),
      readiness: () => ({ ready: true, findings: [] }),
      callModel: async (m) => { seen.push(m.slice()); return steps.shift() ?? reply(call("finish", {})); },
    });
    const tools = seen.flat().filter((x) => x.role === "tool").map((x) => String(x.content)).join("\n");
    expect(tools).toContain(doc.content.slice(0, 60));
    expect(r.files.map((f) => f.path)).not.toContain(doc.path);
    expect(r.files.map((f) => f.path)).toContain("src/pages/Home.tsx");
  });

  it("5. the template contract stays authoritative and lives once, in the brief", () => {
    const ctx = build();
    const brief = firstBuildBrief("bakery", [{ route: "/", file: "src/pages/Home.tsx" }], []);
    expect(brief).toContain(TEMPLATE_PRELOADED_RULE);
    expect(ctx.system).not.toContain(TEMPLATE_PRELOADED_RULE);
    expect(ctx.system).not.toMatch(/^SCAFFOLD \(already injected/m);
  });

  it("6. starter-kit visibility is unchanged: the loop still receives the kit alongside knowledge docs", () => {
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).toMatch(/reference: applyScaffoldKit\(\[\][\s\S]{0,300}\.concat\(fbContext\.reference\)/);
    expect(src).toContain("system: fbContext.system");
    expect(src).not.toContain("systemTextOf(finalMessages) + FIRST_BUILD_TOOL_NOTE");
  });

  it("7. the product contract is carried; the design playbook is not duplicated in system", () => {
    const ctx = build({ productContract: { prd: "### Product requirements\n- Menu page" } });
    expect(ctx.system).toContain("### Product requirements");
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    const call = src.slice(src.indexOf("assembleFirstBuildContext({"), src.indexOf("const done = await runToolLoop({"));
    expect(call).not.toContain("designSystemBlock");
    expect(ctx.parts.system).toBe(ctx.system.length);
    expect(Object.keys(ctx.parts)).toEqual(expect.arrayContaining(["baseRules", "manualAlways", "conditional", "productContract", "knowledgeIndex"]));
  });

  it("assembly is deterministic (stable, cacheable prefix)", () => {
    expect(build().system).toBe(build().system);
  });
});

describe("batching and work units", () => {
  it("the tool note asks for coherent batches, not forced batching or forced splitting", () => {
    expect(FIRST_BUILD_TOOL_NOTE).toMatch(/Batch only coherent work/);
    expect(FIRST_BUILD_TOOL_NOTE).toMatch(/neither one file per response nor everything at once/);
    expect(FIRST_BUILD_TOOL_NOTE).not.toMatch(/Emit several create_file calls/);
  });

  it("9. a dependency-safe batch lands in one step and is validated immediately", async () => {
    const steps = [
      reply(
        call("create_file", { path: "src/components/brand.tsx", content: "export function Brand(){return null}" }),
        call("create_file", { path: "src/pages/Home.tsx", content: `import { Brand } from "@/components/brand";\nexport default function Home(){return <Brand/>}` }),
      ),
    ];
    const traces: Array<{ writes: number; progress: boolean; workUnit: string }> = [];
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      validate: (f, t) => validateUnitImports(f, t).map((d) => d.message),
      readiness: () => ({ ready: true, findings: [] }),
      onTrace: (t) => traces.push(t),
      callModel: async () => steps.shift() ?? reply(call("finish", {})),
    });
    expect(traces[0]!.writes).toBe(2);
    expect(traces[0]!.progress).toBe(true);
    expect(traces[0]!.workUnit).toBe("page");
    expect(r.state.validation.get("src/pages/Home.tsx") ?? []).toEqual([]);
  });

  it("10. an unsafe batch (import of an unwritten module) is flagged at once and fixed in the next unit", async () => {
    const seen: LoopMessage[][] = [];
    const steps = [
      reply(call("create_file", { path: "src/pages/Home.tsx", content: `import { Brand } from "@/components/brand";\nexport default function Home(){return <Brand/>}` })),
      reply(call("create_file", { path: "src/components/brand.tsx", content: "export function Brand(){return null}" })),
    ];
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [],
      validate: (f, t) => validateUnitImports(f, t).map((d) => d.message),
      readiness: () => ({ ready: true, findings: [] }),
      callModel: async (m) => { seen.push(m.slice()); return steps.shift() ?? reply(call("finish", {})); },
    });
    const firstResult = seen[1]!.filter((x) => x.role === "tool").map((x) => String(x.content)).join("\n");
    expect(firstResult).toMatch(/brand/i);
    expect(r.outcome).toBe("finished");
  });

  it("classifies work units from tool calls and paths", () => {
    expect(classifyWorkUnit(["create_file"], ["src/pages/Menu.tsx"])).toBe("page");
    expect(classifyWorkUnit(["create_file"], ["src/App.tsx"])).toBe("router");
    expect(classifyWorkUnit(["create_file"], ["src/components/footer.tsx"])).toBe("layout");
    expect(classifyWorkUnit(["create_file"], ["src/lib/menu-data.ts"])).toBe("shared");
    expect(classifyWorkUnit(["read_file"], [])).toBe("read");
    expect(classifyWorkUnit(["finish"], [])).toBe("finish");
    expect(classifyWorkUnit([], [])).toBe("none");
  });
});

describe("telemetry and provider performance", () => {
  it("each trace carries context split, provider, speed, work unit and progress", async () => {
    const traces: any[] = [];
    await runToolLoop({
      goal: "g", system: "SYSTEM", brief: "BRIEF", files: [],
      validate: () => [],
      readiness: () => ({ ready: true, findings: [] }),
      onTrace: (t) => traces.push(t),
      callModel: async () => ({ ...reply(call("finish", {})), upstream: "Azure", ttftMs: 100, usage: { promptTokens: 10, cachedTokens: 0, completionTokens: 50 } }),
    });
    const t = traces[0];
    expect(t.upstream).toBe("Azure");
    expect(t.context.system).toBe(6);
    expect(t.context.brief).toBe(5);
    expect(t.workUnit).toBe("finish");
    expect(typeof t.progress).toBe("boolean");
  });

  it("code routing adds a soft throughput preference, never an allow-list", () => {
    const r = codegenProviderRouting() as Record<string, any>;
    expect(r.only).toBeUndefined();
    expect(r.order).toBeUndefined();
    expect(r.allow_fallbacks).toBe(true);
    expect(r.preferred_min_throughput?.p50).toBeGreaterThan(0);
    const prev = process.env.CODEGEN_PREFERRED_MIN_TPS;
    process.env.CODEGEN_PREFERRED_MIN_TPS = "0";
    try {
      expect((codegenProviderRouting() as Record<string, unknown>).preferred_min_throughput).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CODEGEN_PREFERRED_MIN_TPS; else process.env.CODEGEN_PREFERRED_MIN_TPS = prev;
    }
  });
});
