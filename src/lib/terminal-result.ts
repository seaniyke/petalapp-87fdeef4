/**
 * The ONE authoritative formatter for a turn's terminal result.
 *
 * Every final user-visible message for a turn that did NOT commit is built
 * here from facts (commit outcome, revisions, rolled-back paths, failure
 * category) — never from the model's narration or from earlier optimistic
 * salvage notes. The same record is persisted with the assistant message so
 * a refresh / reopen reconstructs exactly the same verdict.
 */

export type TerminalCategory =
  | "verification_failed"
  | "scope_violation"
  | "infrastructure"
  | "cancelled"
  | "circuit_breaker"
  | "unknown";

export type TerminalRejection = { path?: string | null; detail: string };

export type TerminalResult = {
  turnId: string | null;
  outcome: "failed" | "aborted";
  category: TerminalCategory;
  /** True only when a new revision was committed by this turn. */
  projectChanged: boolean;
  baseRevision: number | null;
  committedRevision: number | null;
  /** What the user still has: always the previous saved version on rollback. */
  preserved: string;
  rejections: TerminalRejection[];
  nextAction: string;
  /** Partial first build: validated work kept (resumable), what is still open. */
  partial?: { kept: string[]; remaining: string[] } | null;
};

const PRESERVED_ROLLBACK = "Your app was left exactly as it was before this request — no files were changed.";

export function categoryFromReason(reason: string | null | undefined): TerminalCategory {
  const r = (reason ?? "").toLowerCase();
  if (!r) return "unknown";
  if (r.includes("cancel") || r.includes("stopped by user") || r === "aborted") return "cancelled";
  if (r.includes("scope_violation")) return "scope_violation";
  if (r.includes("circuit")) return "circuit_breaker";
  if (r.includes("verification") || r.includes("source_verification") || r.includes("does not exist")) return "verification_failed";
  if (/\b(5\d\d|timeout|timed out|provider|upstream|network|stalled?)\b/.test(r)) return "infrastructure";
  return "unknown";
}

function nextActionFor(category: TerminalCategory): string {
  switch (category) {
    case "cancelled":
      return "Send a new message whenever you're ready.";
    case "infrastructure":
      return "This was a problem on Kimble's side, not your request. Send it again and Kimble will pick up from your saved version.";
    case "circuit_breaker":
      return "Try asking for a smaller part of this change first.";
    default:
      return "Send it again and Kimble will retry just the part that failed.";
  }
}

export function buildTerminalResult(input: {
  turnId: string | null;
  outcome?: "failed" | "aborted";
  reason?: string | null;
  category?: TerminalCategory;
  baseRevision?: number | null;
  committedRevision?: number | null;
  rejections?: TerminalRejection[];
  partial?: { kept: string[]; remaining: string[] } | null;
}): TerminalResult {
  const category = input.category ?? (input.outcome === "aborted" ? "cancelled" : categoryFromReason(input.reason));
  const committed = input.committedRevision ?? null;
  const base = input.baseRevision ?? null;
  const projectChanged = committed != null && committed !== base;
  return {
    turnId: input.turnId,
    outcome: input.outcome ?? (category === "cancelled" ? "aborted" : "failed"),
    category,
    projectChanged,
    baseRevision: base,
    committedRevision: committed,
    preserved: projectChanged
      ? `Revision ${committed} was saved before the failure; later work in this request was not.`
      : PRESERVED_ROLLBACK,
    rejections: (input.rejections ?? []).slice(0, 5).map((r) => ({ path: r.path ?? null, detail: r.detail.slice(0, 300) })),
    nextAction: input.partial?.kept.length
      ? "Say \"continue\" and Kimble will pick up from the finished parts instead of starting again."
      : nextActionFor(category),
    partial: input.partial?.kept.length ? { kept: input.partial.kept.slice(0, 20), remaining: input.partial.remaining.slice(0, 10) } : null,
  };
}

const HEADLINES: Record<TerminalCategory, string> = {
  verification_failed: "Kimble couldn't finish this request — the new code didn't pass its safety checks, so nothing was saved.",
  scope_violation: "Kimble stopped this request because it tried to change parts of your app you didn't ask about.",
  infrastructure: "Kimble couldn't finish this request because its AI service stopped responding.",
  cancelled: "You stopped this request.",
  circuit_breaker: "Kimble stopped after repeated failed attempts instead of looping.",
  unknown: "Kimble couldn't finish this request.",
};

/** The single final message text. Contains no success/landed language. */
export function formatTerminalResult(r: TerminalResult): string {
  if (r.partial && r.partial.kept.length) {
    const lines = [
      "Kimble built part of this request, then stopped before it was finished. It is not in your app yet.",
      "",
      `Finished and checked (kept for the next attempt): ${r.partial.kept.map((p) => `\`${p}\``).join(", ")}`,
    ];
    if (r.partial.remaining.length) {
      lines.push("", "Still to do:");
      for (const x of r.partial.remaining) lines.push(`- ${x}`);
    }
    lines.push("", r.nextAction);
    return lines.join("\n");
  }
  const lines = [HEADLINES[r.category], "", r.preserved];
  if (r.rejections.length > 0) {
    lines.push("", "What failed:");
    for (const x of r.rejections) lines.push(`- ${x.path ? `\`${x.path}\` — ` : ""}${x.detail}`);
  }
  lines.push("", r.nextAction);
  return lines.join("\n");
}

/** Phrases that must never appear in a non-committed terminal message. */
export const OPTIMISTIC_PHRASES = [
  /everything else landed/i,
  /is still in a working state/i,
  /\bit'?s live\b/i,
  /\bships? with\b/i,
  /\bis ready\b/i,
  /changes (are|were) saved/i,
];

export function containsOptimisticClaim(text: string): boolean {
  return OPTIMISTIC_PHRASES.some((re) => re.test(text));
}
