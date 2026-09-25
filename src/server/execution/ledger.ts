/**
 * Turn ledger — explicit per-turn limits and tool discipline.
 *
 * Every tool operation goes through `use(kind)`; a cancelled turn or an
 * exhausted limit is refused. Reads are deduplicated; writes identical to the
 * current content are refused as no-ops; one writer owns the turn.
 */
export type ToolKind = "ai_call" | "read" | "write" | "delete" | "dependency" | "repair" | "build" | "browser";

export const TURN_LIMITS: Readonly<Record<ToolKind, number>> = {
  ai_call: 12,
  read: 80,
  write: 40,
  delete: 10,
  dependency: 6,
  repair: 3,
  build: 2,
  browser: 1,
};

export type Refusal = "cancelled" | "limit" | "duplicate_read" | "no_op_write" | "foreign_writer" | "committed";

export interface LedgerEvent {
  kind: ToolKind;
  target?: string;
  purpose: string;
  ok: boolean;
  refusal?: Refusal;
}

export class TurnLedger {
  private counts = new Map<ToolKind, number>();
  private reads = new Set<string>();
  private events: LedgerEvent[] = [];
  private writer: string | null = null;
  cancelled = false;
  committed = false;

  constructor(private limits: Readonly<Record<ToolKind, number>> = TURN_LIMITS) {}

  cancel(): void {
    this.cancelled = true;
  }

  /** Claim the turn for one writer. A second writer is refused. */
  claimWriter(id: string): boolean {
    if (this.writer && this.writer !== id) return false;
    this.writer = id;
    return true;
  }

  use(kind: ToolKind, purpose: string, target?: string, writer?: string): { ok: true } | { ok: false; refusal: Refusal } {
    const refuse = (refusal: Refusal) => {
      this.events.push({ kind, target, purpose, ok: false, refusal });
      return { ok: false as const, refusal };
    };
    if (this.cancelled) return refuse("cancelled");
    if (this.committed && kind !== "read") return refuse("committed");
    if ((kind === "write" || kind === "delete") && writer && !this.claimWriter(writer)) return refuse("foreign_writer");
    if (kind === "read" && target) {
      if (this.reads.has(target)) return refuse("duplicate_read");
    }
    const n = this.counts.get(kind) ?? 0;
    if (n >= this.limits[kind]) return refuse("limit");
    this.counts.set(kind, n + 1);
    if (kind === "read" && target) this.reads.add(target);
    this.events.push({ kind, target, purpose, ok: true });
    return { ok: true };
  }

  /** Write discipline: refuse a write whose bytes equal the current file. */
  write(path: string, next: string, current: string | undefined, purpose: string, writer?: string) {
    if (current !== undefined && current === next) {
      this.events.push({ kind: "write", target: path, purpose, ok: false, refusal: "no_op_write" });
      return { ok: false as const, refusal: "no_op_write" as Refusal };
    }
    return this.use("write", purpose, path, writer);
  }

  count(kind: ToolKind): number {
    return this.counts.get(kind) ?? 0;
  }

  summary() {
    return {
      counts: Object.fromEntries(this.counts),
      refusals: this.events.filter((e) => !e.ok).map((e) => `${e.kind}:${e.refusal}${e.target ? `:${e.target}` : ""}`).slice(0, 30),
      filesRead: [...this.reads].slice(0, 40),
      filesWritten: this.events.filter((e) => e.ok && e.kind === "write").map((e) => e.target!).slice(0, 40),
      cancelled: this.cancelled,
      committed: this.committed,
    };
  }
}
