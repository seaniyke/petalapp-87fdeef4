/**
 * Honest edit fallbacks.
 *
 * When the AI can't produce a usable edit, a deterministic fallback may only
 * apply a patch that does EXACTLY what was asked — a short, single-purpose
 * request with no other instruction in it. Anything else ends the turn as
 * "failed" (reason "no_safe_edit"): no revision, no charge, and a plain reply
 * saying nothing changed. A fallback that does something else and reports
 * "applied" is never allowed.
 */
import type { ProjectFile } from "./generate.server";

/** Content signals that mean the request asks for more than one generic thing. */
const CONTENT_SIGNAL_RE =
  /\b(remove|delete|drop|rename|price[sd]?|pricing|cost|phone|whatsapp|e-?mail|address|hours|menu|testimonials?|reviews?)\b|[₦$€£]\s?\d|\+?\d[\d\s()-]{7,}\d|https?:\/\/|\bwa\.me\b|\btel:|\bmailto:|@/i;
const EDIT_VERB_RE = /\b(change|replace|swap|edit|update|move|fix|rewrite)\b/i;

/** Short and to the point: one or two sentences, a couple of hundred characters. */
export function isShortSingleAsk(prompt: string, maxChars = 240): boolean {
  const text = (prompt ?? "").trim();
  if (!text || text.length > maxChars) return false;
  const sentences = text.split(/[.!?]+(?:\s+|$)|\n+/).filter((s) => s.trim().length > 0);
  return sentences.length <= 2;
}

/**
 * True when the request carries instructions beyond the fallback's own job
 * (remove, rename, price, phone, links…). `allowEditVerbs` lets an ask whose
 * own job is a change ("change the hero background") through.
 */
export function hasOtherInstructions(prompt: string, opts: { allowEditVerbs?: boolean } = {}): boolean {
  const text = prompt ?? "";
  if (CONTENT_SIGNAL_RE.test(text)) return true;
  if (!opts.allowEditVerbs && EDIT_VERB_RE.test(text)) return true;
  return false;
}

export type FallbackKind = "brand_mark" | "hero_background" | "section_expansion";

/** Gate shared by every deterministic edit fallback. */
export function fallbackMayApply(kind: FallbackKind, prompt: string): boolean {
  if (!isShortSingleAsk(prompt)) return false;
  return !hasOtherInstructions(prompt, { allowEditVerbs: kind === "hero_background" });
}

export const NO_SAFE_EDIT_SUMMARY =
  "I couldn't finish that change, so nothing on your site was changed and you weren't charged. Send it again, or split it into smaller requests.";

/** The terminal outcome for an edit that could not be completed. */
export function noSafeEditOutcome(): { outcome: "failed"; reason: "no_safe_edit"; summary: string } {
  return { outcome: "failed", reason: "no_safe_edit", summary: NO_SAFE_EDIT_SUMMARY };
}

export interface ConversationalFallbackArgs {
  summary: string;
  files: ProjectFile[];
  suggestions?: string[];
  outcome?: "answered" | "blocked" | "failed";
  blockedPaths?: string[];
  reason?: string;
  streamSummary?: boolean;
}

/**
 * The events a turn that changes nothing emits: an optional summary, the
 * authoritative turn_outcome, and a result with the unchanged files, no
 * credits and `noFileChanges` (so nothing is saved as a new revision).
 */
export function conversationalFallbackEvents(args: ConversationalFallbackArgs): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  if (args.streamSummary !== false) events.push({ type: "summary_delta", delta: args.summary });
  const blocked = args.blockedPaths && args.blockedPaths.length
    ? { blockedPaths: Array.from(new Set(args.blockedPaths)).slice(0, 20) }
    : {};
  events.push({
    type: "turn_outcome",
    outcome: args.outcome ?? "answered",
    changedPaths: [],
    ...blocked,
    ...(args.reason ? { reason: args.reason } : {}),
  });
  events.push({
    type: "result",
    files: args.files,
    summary: args.summary,
    plan: undefined,
    recap: undefined,
    creditsCharged: 0,
    noFileChanges: true,
    ...(args.suggestions && args.suggestions.length > 0 ? { suggestions: args.suggestions } : {}),
  });
  return events;
}
