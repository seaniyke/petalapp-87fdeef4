/**
 * Lifecycle phase for the agent context: FIRST_BUILD_CONTEXT or
 * ITERATION_CONTEXT. Rendered into the EXISTING prompt assembly (no second
 * prompt engine). Pure; the caller supplies the state it already loaded.
 */
import type { ExecutionDepth } from "@/server/execution/depth";

export interface LifecycleState {
  isInitial: boolean;
  operationType: string;
  executionDepth: ExecutionDepth;
  currentRevision: number | null;
  buildRevision: number | null;
  buildStatus: string | null;
  publishedRevision: number | null;
  designSystem: string | null;
  accent: string | null;
  routes: string[];
  relevantFiles: string[];
  recentChanges: string[];
  knownIssues: string[];
}

const list = (xs: string[], n = 12) => (xs.length ? xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n})` : "") : "none recorded");

export function renderLifecycleContext(s: LifecycleState): string {
  if (s.isInitial) {
    return [
      "## FIRST_BUILD_CONTEXT",
      "This is the first build of a new project. Establish the foundation: routes, pages, shared layout and the selected design system.",
      `Operation: ${s.operationType} · execution depth: ${s.executionDepth}`,
    ].join("\n");
  }
  const rev = (n: number | null) => (n == null ? "unknown" : `revision ${n}`);
  return [
    "## ITERATION_CONTEXT",
    "This is an EXISTING application. You are modifying it, not generating it from scratch.",
    `Current code: ${rev(s.currentRevision)} (your change becomes the next revision) · last build: ${rev(s.buildRevision)}${s.buildStatus ? ` (${s.buildStatus})` : ""} · live/published: ${rev(s.publishedRevision)}`,
    `Design system: ${s.designSystem ?? "legacy (no package)"}${s.accent ? ` · accent ${s.accent}` : ""}`,
    `Routes: ${list(s.routes)}`,
    `Files relevant to this request (inspected for you): ${list(s.relevantFiles)}`,
    `Recent changes: ${list(s.recentChanges, 5)}`,
    `Known verification issues: ${list(s.knownIssues, 5)}`,
    `Operation: ${s.operationType} · execution depth: ${s.executionDepth}`,
    "Rules for this iteration:",
    "- Existing code is authoritative; preserve the architecture unless the user explicitly asks to change it.",
    "- Preserve the selected design system (colours, fonts, tokens, accent) unless the user explicitly asks for a design-system change.",
    "- Preserve existing working behaviour unless the user asks to change it.",
    "- Scope the change to the request; do not regenerate unrelated files.",
    "- Only overwrite files whose current content you were given; others are refused at the write boundary.",
    "- Precedence: current request > project requirements > build state > memory > history > inference.",
  ].join("\n");
}
