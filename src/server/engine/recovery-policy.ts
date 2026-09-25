/**
 * THE bounded recovery table. Every recovery decision in the build engine
 * checks here; nothing retries outside these limits.
 *
 * It is also the turn's ONE recovery record: every retry/repair in the turn
 * writes what it tried and why it failed here, and every later attempt reads a
 * compact summary back — so attempt 3 knows what attempts 1 and 2 did instead
 * of starting over from the latest error alone. No new loop, no new limits.
 */
export type FailureKind =
  | "provider_failure"
  | "truncated_output"
  | "broken_file"
  | "build_failure"
  | "missing_page"
  | "browser_failure";

export const RECOVERY_LIMITS: Readonly<Record<FailureKind, number>> = {
  provider_failure: 2, // same request, next allowed provider (two providers can stall in a row)
  truncated_output: 1, // continue only the missing files
  broken_file: 1, // per file, max MAX_REPAIRED_FILES files
  build_failure: 1, // repair only files named in the error
  missing_page: 1, // generate only the missing page
  browser_failure: 0, // report truthfully
};
export const MAX_REPAIRED_FILES = 3;

export type RecoveryStage = "generation" | "apply" | "validation" | "dependency" | "build" | "browser";

export type RecoveryAttempt = {
  n: number;
  kind: FailureKind | "apply_failure";
  stage: RecoveryStage;
  path: string | null;
  /** Exact failure that triggered this attempt. */
  reason: string;
  /** What was tried (e.g. "resent to another provider", "one-file rewrite"). */
  action: string;
  outcome: "pending" | "fixed" | "failed" | "kept_previous";
  /** Short fingerprint of the candidate this attempt produced, if any. */
  candidate?: string;
  upstream?: string | null;
  at: number;
};

function fingerprint(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}c#${(h >>> 0).toString(16)}`;
}

export class RecoveryBudget {
  private used = new Map<string, number>();
  private attempts: RecoveryAttempt[] = [];
  private request = "";
  private targets: string[] = [];

  /** Turn identity for the record: original request + intended scope. */
  setTurn(args: { request: string; targets: string[] }): void {
    this.request = args.request.slice(0, 600);
    this.targets = args.targets.slice(0, 20);
  }

  /** True (and consumes one attempt) when another attempt is allowed. */
  take(kind: FailureKind, key = ""): boolean {
    const k = `${kind}:${key}`;
    const n = this.used.get(k) ?? 0;
    if (n >= RECOVERY_LIMITS[kind]) return false;
    if (kind === "broken_file" && n === 0) {
      const files = [...this.used.keys()].filter((x) => x.startsWith("broken_file:")).length;
      if (files >= MAX_REPAIRED_FILES) return false;
    }
    this.used.set(k, n + 1);
    return true;
  }

  /** Remaining broken-file repairs for this turn. */
  remainingFileRepairs(): number {
    const files = [...this.used.keys()].filter((x) => x.startsWith("broken_file:")).length;
    return Math.max(0, MAX_REPAIRED_FILES - files);
  }

  record(a: Omit<RecoveryAttempt, "n" | "at" | "outcome" | "candidate"> & { outcome?: RecoveryAttempt["outcome"]; candidateContent?: string | null }): number {
    const n = this.attempts.length + 1;
    const { candidateContent, ...rest } = a;
    this.attempts.push({
      ...rest,
      reason: rest.reason.slice(0, 400),
      outcome: a.outcome ?? "pending",
      ...(candidateContent ? { candidate: fingerprint(candidateContent) } : {}),
      n,
      at: Date.now(),
    });
    return n;
  }

  resolve(n: number, outcome: RecoveryAttempt["outcome"], candidateContent?: string | null): void {
    const a = this.attempts.find((x) => x.n === n);
    if (!a) return;
    a.outcome = outcome;
    if (candidateContent) a.candidate = fingerprint(candidateContent);
  }

  /** Mark every still-pending attempt on a path. */
  resolvePath(path: string, outcome: RecoveryAttempt["outcome"]): void {
    for (const a of this.attempts) if (a.path === path && a.outcome === "pending") a.outcome = outcome;
  }

  history(): readonly RecoveryAttempt[] {
    return this.attempts;
  }

  /**
   * Compact, relevant slice of the turn record for the next attempt. Path-
   * specific attempts first, then turn-wide ones. Never the transcript.
   */
  summarize(path?: string | null, maxChars = 1400): string {
    const relevant = this.attempts.filter((a) => !path || a.path === path || a.path === null);
    const lines: string[] = [];
    if (this.request) lines.push(`Original request: ${this.request}`);
    if (this.targets.length) lines.push(`Intended scope: ${this.targets.join(", ")}`);
    if (relevant.length) {
      lines.push("Earlier attempts in THIS request (same turn):");
      for (const a of relevant) {
        lines.push(
          `  #${a.n} [${a.stage}] ${a.path ?? "whole response"}: ${a.action} — because: ${a.reason} → ${a.outcome}${a.candidate ? ` (candidate ${a.candidate})` : ""}`,
        );
      }
    }
    lines.push(`Repairs left this turn: ${this.remainingFileRepairs()}.`);
    let out = lines.join("\n");
    if (out.length > maxChars) out = `${out.slice(0, maxChars - 12)}\n…(trimmed)`;
    return out;
  }
}
