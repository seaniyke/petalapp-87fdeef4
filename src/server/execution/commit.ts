/**
 * Live commit boundary for /api/generate.
 *
 * The turn's proposed tree is staged into a TurnTransaction (accounted by the
 * turn's TurnLedger), checked against the execution scope and the recorded
 * validation verdicts, then committed as ONE mutation. Only a committed
 * outcome may be persisted; a rolled-back outcome returns the baseline and a
 * structured rejection for the agent/summary.
 */
import type { TurnLedger } from "./ledger";
import { TurnTransaction, type TxFile, type TxOutcome } from "./transaction";
import type { Verdict } from "./verdict";

export interface CommitRejection {
  operation: "write" | "delete" | "commit";
  path?: string;
  reason: "scope_violation" | "limit" | "foreign_writer" | "cancelled" | "validation_failed" | "no_changes" | "other";
  detail: string;
  recoverable: boolean;
  next: string;
}

export interface CommitTurnArgs {
  baseline: TxFile[];
  proposed: TxFile[];
  ledger: TurnLedger;
  /** Paths Kimble manages itself (scaffold/kit). Staged, not budgeted, not scoped. */
  isSystemPath: (path: string) => boolean;
  /** Execution-scope protection reason for an authored path, or null. */
  protectionReason: (path: string) => string | null;
  /** Verdicts from validation that already ran on the proposed tree. */
  checks: Array<{ check: string; verdict: Verdict; detail?: string }>;
  cancelled: () => boolean;
}

export interface CommitTurnResult {
  outcome: TxOutcome;
  rejections: CommitRejection[];
  noOps: string[];
}

export function commitTurn(args: CommitTurnArgs): CommitTurnResult {
  const tx = new TurnTransaction(args.baseline, args.ledger);
  const base = new Map(args.baseline.map((f) => [f.path, f.content]));
  const next = new Map<string, string>();
  for (const f of args.proposed) {
    const p = f.path.trim();
    if (p) next.set(p, f.content ?? "");
  }
  const rejections: CommitRejection[] = [];
  const noOps: string[] = [];

  const refusalReason = (): CommitRejection["reason"] => {
    const last = args.ledger.summary().refusals.at(-1) ?? "";
    if (last.includes(":limit")) return "limit";
    if (last.includes(":foreign_writer")) return "foreign_writer";
    if (last.includes(":cancelled")) return "cancelled";
    return "other";
  };

  for (const [path, content] of next) {
    const system = args.isSystemPath(path);
    if (base.get(path) === content) continue;
    if (!system) {
      const why = args.protectionReason(path);
      if (why) {
        rejections.push({
          operation: "write",
          path,
          reason: "scope_violation",
          detail: why,
          recoverable: true,
          next: "retry without changing this file, or name it explicitly in the request",
        });
        continue;
      }
    }
    if (!tx.stage(path, content, "turn change", { system })) {
      const reason = refusalReason();
      rejections.push({
        operation: "write",
        path,
        reason,
        detail: `write refused (${reason})`,
        recoverable: reason === "limit",
        next: reason === "limit" ? "split the request into smaller steps" : "stop",
      });
    }
  }
  for (const path of base.keys()) {
    if (next.has(path)) continue;
    if (!args.isSystemPath(path) && args.protectionReason(path)) {
      rejections.push({
        operation: "delete",
        path,
        reason: "scope_violation",
        detail: args.protectionReason(path)!,
        recoverable: true,
        next: "retry without removing this file",
      });
      continue;
    }
    if (!tx.remove(path, { system: args.isSystemPath(path) })) {
      const reason = refusalReason();
      rejections.push({ operation: "delete", path, reason, detail: `delete refused (${reason})`, recoverable: reason === "limit", next: "stop" });
    }
  }
  // No-op writes the model proposed are visible in the ledger's refusals.
  for (const r of args.ledger.summary().refusals) {
    if (r.startsWith("write:no_op_write:")) noOps.push(r.slice("write:no_op_write:".length));
  }

  for (const c of args.checks) tx.recordCheck(c.check, c.verdict, c.detail);
  // A refused authored mutation means the proposed tree cannot land as one
  // coherent state: block the whole commit (atomic), never partially persist.
  if (rejections.length) {
    tx.recordCheck(
      "execution_boundary",
      "FAIL",
      rejections.slice(0, 3).map((r) => `${r.operation} ${r.path ?? ""}: ${r.reason}`).join("; "),
    );
  }
  if (args.cancelled()) args.ledger.cancel();

  const outcome = tx.commit();
  if (outcome.status === "rolled_back" && rejections.length === 0) {
    rejections.push({
      operation: "commit",
      reason: outcome.reason === "cancelled" ? "cancelled" : outcome.reason === "no changes" ? "no_changes" : "validation_failed",
      detail: outcome.reason,
      recoverable: outcome.reason !== "cancelled",
      next: outcome.reason === "cancelled" ? "stop" : "fix the failing check and retry",
    });
  }
  return { outcome, rejections, noOps };
}
