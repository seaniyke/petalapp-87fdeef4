/**
 * THE readiness verdict. One reading of the authoritative source-verification
 * record (gates.ts via verifyProposedSource), used by BOTH:
 *   - the execution loop's `finish` (can the agent stop?), and
 *   - commitTurn (can the turn commit?).
 *
 * Neither caller keeps its own list of what "complete" means; both ask this
 * module about the same record computed from the same proposed workspace.
 * Hierarchy: operation evidence (per-write validation) → workspace readiness
 * (this) → turn completion (commit) → publish readiness (build/browser gates).
 */
import type { Verdict } from "@/server/execution/verdict";

export interface SourceVerification {
  status: "READY" | "FAILED" | "UNVERIFIED" | "IN_PROGRESS";
  gates: Array<{ gate: string; verdict: Verdict; reasons: string[]; paths: string[] }>;
  failedGate: string | null;
  reason: string | null;
  repairTargets: string[];
}

export interface ReadinessFinding {
  gate: string;
  reason: string;
  /** Files that must change to clear this finding (may be empty). */
  paths: string[];
}

export interface Readiness {
  ready: boolean;
  findings: ReadinessFinding[];
}

/**
 * FAILED blocks; UNVERIFIED blocks (not proven); READY / IN_PROGRESS (source
 * passed, build pending) permit. Every failing gate is reported, not just the
 * first, so the agent can clear them in one pass.
 */
export function readinessOf(v: SourceVerification | null): Readiness {
  if (!v) return { ready: false, findings: [{ gate: "source", reason: "source verification did not run", paths: [] }] };
  if (v.status === "READY" || v.status === "IN_PROGRESS") return { ready: true, findings: [] };
  const findings: ReadinessFinding[] = [];
  for (const g of v.gates) {
    if (g.verdict !== "FAIL") continue;
    for (const r of g.reasons.length ? g.reasons : [`${g.gate} failed`]) findings.push({ gate: g.gate, reason: r, paths: g.paths });
  }
  if (!findings.length) {
    findings.push({ gate: v.failedGate ?? "source", reason: v.reason ?? (v.status === "UNVERIFIED" ? "verification could not complete" : "verification failed"), paths: v.repairTargets });
  }
  return { ready: false, findings };
}

/** Stable key for a finding (regression detection across workspace states). */
export function findingKey(f: ReadinessFinding): string {
  return `${f.gate}|${f.reason}`;
}
