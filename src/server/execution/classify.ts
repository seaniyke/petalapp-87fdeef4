/**
 * Deterministic request classification → operation + execution mode.
 * No AI call. Reads the request and the Project Context selection.
 */
import type { ProjectManifest } from "@/server/context/manifest";

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

export function classifyRequest(
  request: string,
  opts: { isInitial: boolean; isRepairTurn?: boolean; targetCount?: number; manifest?: ProjectManifest | null },
): Classification {
  const r = request || "";
  const direct = (operation: Operation, reason: string): Classification => ({ operation, planRequired: false, mode: "direct", reason });
  if (opts.isInitial) return { operation: "first_build", planRequired: false, mode: "staged", reason: "no project yet" };
  if (opts.isRepairTurn || (R.repair.test(r) && !R.newPage.test(r))) return direct("repair", "defect reported");
  if (R.arch.test(r)) return { operation: "architectural_change", planRequired: true, mode: "staged", reason: "reaches across the app" };
  if (R.newPage.test(r)) return { operation: "page_creation", planRequired: false, mode: "staged", reason: "new page requested" };
  if (R.dep.test(r)) return direct("dependency_change", "dependency/config words");
  if (R.asset.test(r)) return direct("asset_change", "imagery words");
  if (R.func.test(r)) return direct("functionality_change", "behaviour words");
  if (R.content.test(r)) return direct("content_change", "copy words");
  if (R.style.test(r)) return direct("styling_change", "visual words");
  const pageHit = opts.manifest?.pages.some((p) => r.toLowerCase().includes(p.type)) ?? false;
  if (pageHit) return direct("page_modification", "names a page");
  return direct("component_modification", "default targeted edit");
}
