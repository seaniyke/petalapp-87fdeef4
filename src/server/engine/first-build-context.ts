/**
 * First-build context assembly — minimum sufficient context per work unit.
 *
 * Before this module the first-build tool loop received the WHOLE edit-mode
 * system prompt (`systemTextOf(finalMessages)`): the monolithic write_project
 * prompt, the full manual, the Kimble skills block, the design-taste manual,
 * the design playbook (a second time), PRD, PIC … ~45–55k tokens resent on
 * every loop step, parts of it contradicting tool mode ("always respond by
 * calling write_project", "emit src/styles.css" while stylesheet writes are
 * refused).
 *
 * Now knowledge is tiered, with ONE source per rule:
 *   ALWAYS-ON    universal rules every first build needs (in `system`).
 *   CONDITIONAL  rules for the work this build actually does, chosen once from
 *                the classified request (in `system`, so the prefix stays
 *                byte-stable and cacheable across loop steps).
 *   ON-DEMAND    everything else — full manual sections, skills, design-taste
 *                manual, prerequisite gating — exposed as read-only
 *                `knowledge/*.md` reference files. The model retrieves them
 *                with read_file when the current work unit needs them. Nothing
 *                is deleted; the exact text is always recoverable.
 *
 * Pure and deterministic: no AI calls, no I/O. No token ceiling — sizes are
 * measured and reported (`parts`) for telemetry, never used to truncate.
 */
import type { ProjectFile } from "@/server/generate.server";

/* ------------------------------------------------------------------ */
/* Sectioning                                                          */
/* ------------------------------------------------------------------ */

export interface Section {
  title: string;
  slug: string;
  text: string;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";
}

/** Split Markdown on H2 headings. The preamble (before the first H2) is dropped. */
export function splitMarkdownSections(md: string): Section[] {
  const out: Section[] = [];
  for (const chunk of md.split(/\n(?=## )/)) {
    const first = chunk.split("\n")[0] ?? "";
    if (!first.startsWith("## ")) continue;
    const title = first.replace(/^##\s*/, "").replace(/[^\p{L}\p{N}\s:&().,'`\-—]/gu, "").trim();
    out.push({ title, slug: slugify(title), text: chunk.trim() });
  }
  return out;
}

/**
 * Split the plain-text base prompt into labelled blocks. A block starts at a
 * line whose first word is ALL CAPS (≥4 letters) followed by ':' / '(' / end,
 * or the mixed-case "Hard rules:" label. Block 0 is the intro.
 */
const PROMPT_HEADING = /^(?:Hard rules:|[A-Z][A-Z0-9.-]{3,}(?:[ \/&'-]+[A-Za-z0-9]+)*\s*(?:\(|:|$))/;
export function splitPromptBlocks(prompt: string): Section[] {
  const out: Section[] = [];
  let cur: string[] = [];
  let title = "intro";
  const flush = () => {
    const text = cur.join("\n").trim();
    if (text) out.push({ title, slug: slugify(title), text });
  };
  for (const line of prompt.split("\n")) {
    if (PROMPT_HEADING.test(line)) {
      flush();
      cur = [line];
      title = line.replace(/[:(].*$/, "").trim();
      continue;
    }
    cur.push(line);
  }
  flush();
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function pick(sections: Section[], prefixes: readonly string[]): Section[] {
  return sections.filter((s) => prefixes.some((p) => norm(s.title).startsWith(norm(p))));
}

/* ------------------------------------------------------------------ */
/* Tiering (the one place this is decided)                             */
/* ------------------------------------------------------------------ */

/**
 * Base-prompt blocks that stay true in tool mode. Everything else in the base
 * prompt is write_project-mode only (output format, narrative fields, "emit
 * styles.css", scaffold listing superseded by the template contract) and is
 * NOT sent — its tool-mode equivalents live in the brief and the loop.
 */
export const BASE_ALWAYS = [
  "BRAND IDENTITY",
  "REUSE-FIRST PROTOCOL",
  "ESSENTIAL substitutions",
  "Hard rules",
  "ANTI-PATTERNS",
  "DECLARE-BEFORE-USE",
  "IMAGES",
  "MULTI-PAGE ROUTING",
  "THEMING",
  "DO-NOT-ASSUME RULES",
  "REQUESTED SCOPE",
] as const;
/** Base blocks that apply only when a backend is attached / absent. */
export const BASE_WITH_BACKEND = ["BACKEND / AUTH RULES", "INSTALLED INTEGRATIONS RULE"] as const;
export const BASE_WITHOUT_BACKEND = ["NO-BACKEND AUTH RULE"] as const;
/** Base blocks kept retrievable, not preloaded. */
export const BASE_ON_DEMAND = ["PREREQUISITE GATING"] as const;

/** Manual (system.md) sections every first build needs. */
export const MANUAL_ALWAYS = [
  "user intent is the highest authority",
  "mobile-first responsive design",
  "accessibility requirements",
  "code quality",
  "component reuse",
] as const;
/** Manual sections for building a new multi-page site from scratch. */
export const MANUAL_FIRST_BUILD = [
  "home page is the primary canvas",
  "design quality standards",
] as const;

/** Agent-knowledge skills preloaded for a given kind of site. */
export function conditionalSkills(subtype: string): string[] {
  if (subtype === "marketing" || subtype === "fullstack") return ["page-composition"];
  return [];
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export interface KnowledgeInputs {
  /** Base first-build prompt (plain text, labelled blocks). */
  basePrompt: string;
  /** Filtered full manual (Markdown, H2 sections). */
  manual: string;
  /** Agent-knowledge skills by id (already filtered). */
  skills: Record<string, string>;
  /** Other retrievable material, by title. Empty entries are skipped. */
  extras: Record<string, string>;
}

export interface FirstBuildContextArgs {
  knowledge: KnowledgeInputs;
  /** Web subtype from classification ("marketing" | "app" | "fullstack" | …). */
  subtype: string;
  hasBackend: boolean;
  /** Request-specific product contract blocks (intent, PRD, PIC, archetype…). */
  productContract: Record<string, string>;
  /** Backend/schema/integration blocks, when present. */
  projectReference: Record<string, string>;
  /** Tool-mode execution note. */
  toolNote: string;
}

export interface FirstBuildContext {
  system: string;
  /** Read-only on-demand docs for the loop's reference set. */
  reference: ProjectFile[];
  /** Character counts per component, for telemetry. */
  parts: Record<string, number>;
  /** Which tier each knowledge unit landed in. */
  tiers: { always: string[]; conditional: string[]; onDemand: string[] };
}

export const KNOWLEDGE_DIR = "knowledge";

const TOOL_MODE_READING =
  "## Kimble build rules (tool mode)\n" +
  "You are Kimble, building a Vite + React + TypeScript app on a pre-installed UI kit (Tailwind CSS v4 + a curated " +
  "shadcn-style component library). You build the app with tools, one validated write at a time. Where a rule below says \"this response\" or " +
  "\"this turn\", read it as \"before you call finish\". Styling, config, package.json and index.html are already " +
  "set up and writes to them are refused — the stylesheet is never yours to emit.";

export function assembleFirstBuildContext(args: FirstBuildContextArgs): FirstBuildContext {
  const blocks = splitPromptBlocks(args.knowledge.basePrompt);
  const manual = splitMarkdownSections(args.knowledge.manual);

  const baseAlways = pick(blocks, [...BASE_ALWAYS, ...(args.hasBackend ? BASE_WITH_BACKEND : BASE_WITHOUT_BACKEND)]);
  const manualAlways = pick(manual, MANUAL_ALWAYS);
  const manualCond = pick(manual, MANUAL_FIRST_BUILD);
  const skillIds = conditionalSkills(args.subtype).filter((id) => args.knowledge.skills[id]);

  const preloaded = new Set([...manualAlways, ...manualCond].map((s) => s.slug));
  const reference: ProjectFile[] = [];
  const index: string[] = [];
  const addDoc = (slug: string, title: string, text: string) => {
    if (!text.trim()) return;
    const path = `${KNOWLEDGE_DIR}/${slug}.md`;
    if (reference.some((r) => r.path === path)) return;
    reference.push({ path, content: text.trim() + "\n" });
    index.push(`- ${path} — ${title} (${Math.round(text.length / 4)} tokens)`);
  };
  for (const s of manual) if (!preloaded.has(s.slug)) addDoc(`manual-${s.slug}`, s.title, s.text);
  for (const [id, text] of Object.entries(args.knowledge.skills)) {
    if (!skillIds.includes(id)) addDoc(`skill-${id}`, `skill: ${id}`, text);
  }
  for (const b of pick(blocks, BASE_ON_DEMAND)) addDoc(`rules-${b.slug}`, b.title, b.text);
  for (const [title, text] of Object.entries(args.knowledge.extras)) addDoc(slugify(title), title, text);

  const baseText = [TOOL_MODE_READING, ...baseAlways.map((b) => b.text)].join("\n\n");
  const manualText = manualAlways.map((s) => s.text).join("\n\n");
  const condText = [
    ...manualCond.map((s) => s.text),
    ...skillIds.map((id) => `## Skill: ${id}\n${args.knowledge.skills[id]!.trim()}`),
  ].join("\n\n");
  const contract = Object.values(args.productContract).filter((t) => t.trim()).join("\n\n");
  const projectRef = Object.values(args.projectReference).filter((t) => t.trim()).join("\n\n");
  const indexText = index.length
    ? `## On-demand knowledge (read-only, retrieve with read_file when the current work needs it)\n` +
      `These are complete and authoritative; nothing in them is summarised away. Read one only when you are about to ` +
      `do the kind of work it covers (e.g. a form, motion, a redesign, icon choice) — not up front.\n${index.join("\n")}`
    : "";

  const system = [baseText, manualText, condText, projectRef, contract, indexText, args.toolNote.trim()]
    .filter((t) => t && t.trim())
    .join("\n\n");

  return {
    system,
    reference,
    parts: {
      baseRules: baseText.length,
      manualAlways: manualText.length,
      conditional: condText.length,
      projectReference: projectRef.length,
      productContract: contract.length,
      knowledgeIndex: indexText.length,
      toolNote: args.toolNote.length,
      system: system.length,
      onDemandDocs: reference.reduce((n, r) => n + r.content.length, 0),
    },
    tiers: {
      always: [...baseAlways.map((b) => `base:${b.title}`), ...manualAlways.map((s) => `manual:${s.title}`)],
      conditional: [...manualCond.map((s) => `manual:${s.title}`), ...skillIds.map((id) => `skill:${id}`)],
      onDemand: reference.map((r) => r.path),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Work-unit classification (telemetry + progress reporting)           */
/* ------------------------------------------------------------------ */

export type WorkUnitKind = "page" | "router" | "layout" | "shared" | "style" | "edit" | "read" | "plan" | "finish" | "none";

/** What a loop step worked on, from its tool calls and written paths. */
export function classifyWorkUnit(toolCalls: string[], writtenPaths: string[]): WorkUnitKind {
  const kinds = writtenPaths.map((p): WorkUnitKind => {
    if (p === "src/App.tsx") return "router";
    if (/^src\/pages\//.test(p)) return "page";
    if (/layout|header|footer|nav/i.test(p)) return "layout";
    if (/\.css$/.test(p)) return "style";
    return "shared";
  });
  if (kinds.length) {
    for (const k of ["page", "router", "layout", "shared", "style"] as const) if (kinds.includes(k)) return k;
  }
  if (toolCalls.includes("edit_file")) return "edit";
  if (toolCalls.includes("finish")) return "finish";
  if (toolCalls.includes("plan_tasks")) return "plan";
  if (toolCalls.some((t) => t === "read_file" || t === "list_files" || t === "search")) return "read";
  return "none";
}
