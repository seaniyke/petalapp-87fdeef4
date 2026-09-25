/**
 * Turn transaction: prepare → modify (staged) → validate → commit.
 * Nothing touches the committed snapshot until commit(); a failed, cancelled
 * or FAIL-verdict turn returns the previous good state untouched.
 */
import type { Verdict } from "./verdict";
import { blocksCommit } from "./verdict";
import type { TurnLedger } from "./ledger";

export interface TxFile {
  path: string;
  content: string;
}

export type TxOutcome =
  | { status: "committed"; files: TxFile[]; changed: string[] }
  | { status: "rolled_back"; files: TxFile[]; reason: string };

export class TurnTransaction {
  private readonly base: ReadonlyMap<string, string>;
  private staged = new Map<string, string | null>();
  private verdicts: Array<{ check: string; verdict: Verdict; detail?: string }> = [];
  private done = false;

  constructor(baseline: TxFile[], private ledger?: TurnLedger, private writer = "primary") {
    this.base = new Map(baseline.map((f) => [f.path, f.content]));
  }

  /**
   * Stage one file. `system: true` marks Kimble-managed files (scaffold kit,
   * housekeeping) — they are staged atomically with the turn but do not
   * consume the model's write budget. No-op writes are refused either way.
   */
  stage(path: string, content: string, purpose = "requested change", opts?: { system?: boolean }): boolean {
    if (this.done) return false;
    const current = this.staged.has(path) ? (this.staged.get(path) ?? undefined) : this.base.get(path);
    if (this.ledger && !opts?.system) {
      const r = this.ledger.write(path, content, current, purpose, this.writer);
      if (!r.ok) return false;
    } else if (current === content) return false;
    this.staged.set(path, content);
    return true;
  }

  /** The complete proposed project tree (baseline + staged), uncommitted. */
  proposedTree(): TxFile[] {
    const next = new Map(this.base);
    for (const [p, c] of this.staged) {
      if (c === null) next.delete(p);
      else next.set(p, c);
    }
    return [...next].map(([path, content]) => ({ path, content }));
  }

  remove(path: string, opts?: { system?: boolean }): boolean {
    if (this.done || !this.base.has(path)) return false;
    if (this.ledger && !opts?.system && !this.ledger.use("delete", "requested removal", path, this.writer).ok) return false;
    this.staged.set(path, null);
    return true;
  }

  recordCheck(check: string, verdict: Verdict, detail?: string): void {
    this.verdicts.push({ check, verdict, detail });
  }

  checks() {
    return [...this.verdicts];
  }

  private baseline(): TxFile[] {
    return [...this.base].map(([path, content]) => ({ path, content }));
  }

  rollback(reason: string): TxOutcome {
    this.done = true;
    this.staged.clear();
    return { status: "rolled_back", files: this.baseline(), reason };
  }

  commit(): TxOutcome {
    if (this.done) return { status: "rolled_back", files: this.baseline(), reason: "already finished" };
    if (this.ledger?.cancelled) return this.rollback("cancelled");
    const failed = this.verdicts.find((v) => blocksCommit(v.verdict));
    if (failed) return this.rollback(`${failed.check} failed${failed.detail ? `: ${failed.detail}` : ""}`);
    if (this.staged.size === 0) return this.rollback("no changes");
    const next = new Map(this.base);
    for (const [p, c] of this.staged) {
      if (c === null) next.delete(p);
      else next.set(p, c);
    }
    this.done = true;
    if (this.ledger) this.ledger.committed = true;
    return {
      status: "committed",
      files: [...next].map(([path, content]) => ({ path, content })),
      changed: [...this.staged.keys()],
    };
  }
}
