/**
 * Deterministic request classification → operation + execution mode.
 * No AI call. Reads the request and the Project Context selection.
 */
import type { ProjectManifest } from "@/server/context/manifest";
import { detectCrossCuttingIntent } from "@/server/intent-targets.server";

/* ---------------- edit facet (size + what is changing) ---------------- */
/*
 * Formerly edit-classifier.server.ts (regex prior + optional AI "widen"
 * call). The AI call is gone; the deterministic facet now lives here so the
 * generation request has ONE classification: operation, mode, scope and
 * dimensions all come from classifyRequest().
 */
export type EditScope = "micro" | "targeted" | "structural";
export type EditDimension = "visual" | "content" | "behaviour" | "data" | "navigation" | "responsive";

export interface EditClassification {
  scope: EditScope;
  dimensions: EditDimension[];
  /** Surface/section words worth matching against real file names. */
  hints: string[];
  reason: string;
  source: "deterministic";
}

const STRUCTURAL_RE =
  /\b(redesign|re-?design|rebuild|revamp|overhaul|from scratch|start over|entire (site|app|website|thing)|whole (site|app|website|thing)|every (page|screen)|all (the )?pages|site-?wide|new (page|screen|feature|section)|add (a |an )?(page|dashboard|auth|login|signup|payments?|checkout|blog)|make it (a )?real|looks? (bad|terrible|awful|plain|generic|unfinished)|doesn'?t look|nothing works)\b/i;
const MICRO_RE = /^\s*(change|rename|fix|update|set|make)\b[^.!?]{0,80}$/i;
const DIMENSION_RE: Array<[EditDimension, RegExp]> = [
  ["visual", /\b(design|theme|colou?rs?|palette|font|typography|spacing|layout|styling|style|look|hero|animation)\b/i],
  ["content", /\b(copy|text|headline|wording|title|label|rename|typo|content)\b/i],
  ["behaviour", /\b(click|button|form|submit|validate|route|link|navigate|filter|sort|search|state|toggle|modal|drawer)\b/i],
  ["data", /\b(database|table|schema|auth|login|sign ?up|store|save|persist|api|backend)\b/i],
  ["navigation", /\b(nav|navbar|navigation|menu|header|footer|sidebar|breadcrumb)\b/i],
  ["responsive", /\b(mobile|phone|tablet|responsive|small screens?|breakpoints?)\b/i],
];

export function classifyEditFacet(prompt: string): EditClassification {
  const text = (prompt ?? "").trim();
  const found = DIMENSION_RE.filter(([, re]) => re.test(text)).map(([d]) => d);
  const dimensions = found.length ? found : (["visual"] as EditDimension[]);
  if (STRUCTURAL_RE.test(text)) return { scope: "structural", dimensions, hints: [], reason: "matched a cross-cutting phrase", source: "deterministic" };
  if (MICRO_RE.test(text) && text.length <= 90) return { scope: "micro", dimensions, hints: [], reason: "short single-verb request", source: "deterministic" };
  return { scope: "targeted", dimensions, hints: [], reason: "default", source: "deterministic" };
}

export type Operation =
  | "first_build"
  | "page_creation"
  | "page_modification"
  | "component_modification"
  | "styling_change"
  | "content_change"
  | "functionality_change"
  | "dependency_change"
  | "asset_change"
  | "architectural_change"
  | "repair";

export interface Classification {
  operation: Operation;
  /** Structured plan first? Only for work that reaches across the app. */
  planRequired: boolean;
  /** Direct = one focused AI edit; staged = full write pipeline. */
  mode: "direct" | "staged";
  reason: string;
  /** Edit size + dimensions (null on a first build). */
  edit: EditClassification | null;
  /** Reaches across the app: pins every page into context, widens scope. */
  crossCutting: boolean;
}

const R = {
  repair: /\b(fix|broken|error|crash|not working|doesn'?t work|blank|bug|failed)\b/i,
  newPage: /\b(add|create|build|make|new)\b[^.!?]{0,40}\b(page|screen|route)s?\b/i,
  arch: /\b(redesign|rebuild|restructure|refactor|entire|whole (site|app)|every page|all pages|across the (site|app)|migrate|convert to)\b/i,
  dep: /\b(install|package|dependency|library|npm|upgrade|config(uration)?|env(ironment)?)\b/i,
  asset: /\b(image|photo|picture|logo|icon|illustration|favicon|video|background image)\b/i,
  style: /\b(colou?r|font|size|bigger|smaller|bold|spacing|padding|margin|rounded|shadow|style|dark|light|theme|align|layout|look)\b/i,
  content: /\b(text|copy|headline|heading|title|wording|rename|say|typo|label|paragraph|description)\b|["“][^"”]{2,}["”]/i,
  func: /\b(button (that|to)|click|submit|form|login|sign ?(in|up)|search|filter|sort|save|cart|checkout|toggle|modal|api|fetch|validate|works?)\b/i,
};

const PAGE_WORDS = /\b(home|landing|about|contact|pricing|menu|blog|login|sign ?in|sign ?up|dashboard|shop|store|product|services|faq|gallery|team|careers|checkout|cart|profile|settings)\s+(page|screen)\b/i;

/** THE classification for a generation request. Deterministic, no AI call. */
export function classifyRequest(
  request: string,
  opts: { isInitial: boolean; isRepairTurn?: boolean; targetCount?: number; manifest?: ProjectManifest | null },
): Classification {
  const r = request || "";
  if (opts.isInitial) {
    return { operation: "first_build", planRequired: false, mode: "staged", reason: "no project yet", edit: null, crossCutting: false };
  }
  const edit = classifyEditFacet(r);
  const crossCutting = detectCrossCuttingIntent(r) || edit.scope === "structural";
  const base = baseOperation(r, opts);
  // A cross-cutting ask is an architectural change whatever keyword matched
  // first (previously an override applied separately in /api/generate).
  // Escalation always requires a plan: a site-wide change must never inherit
  // planRequired=false from the repair/content branch that matched first.
  if (crossCutting && base.operation !== "architectural_change") {
    return { operation: "architectural_change", planRequired: true, mode: "staged", reason: `cross-cutting (${base.reason})`, edit, crossCutting };
  }
  return { ...base, edit, crossCutting };
}

function baseOperation(
  r: string,
  opts: { isRepairTurn?: boolean; manifest?: ProjectManifest | null },
): Omit<Classification, "edit" | "crossCutting"> {
  const direct = (operation: Operation, reason: string) => ({ operation, planRequired: false, mode: "direct" as const, reason });
  if (opts.isRepairTurn || (R.repair.test(r) && !R.newPage.test(r))) return direct("repair", "defect reported");
  if (R.arch.test(r)) return { operation: "architectural_change", planRequired: true, mode: "staged", reason: "reaches across the app" };
  if (R.newPage.test(r)) return { operation: "page_creation", planRequired: false, mode: "staged", reason: "new page requested" };
  if (R.dep.test(r)) return direct("dependency_change", "dependency/config words");
  if (R.asset.test(r)) return direct("asset_change", "imagery words");
  if (R.func.test(r)) return direct("functionality_change", "behaviour words");
  if (R.content.test(r)) return direct("content_change", "copy words");
  if (R.style.test(r)) return direct("styling_change", "visual words");
  const pageHit = PAGE_WORDS.test(r) || (opts.manifest?.pages.some((p) => r.toLowerCase().includes(p.type)) ?? false);
  if (pageHit) return direct("page_modification", "names a page");
  return direct("component_modification", "default targeted edit");
}
