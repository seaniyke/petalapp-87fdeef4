/**
 * Petal v3 — Phase A: the closed-loop pre-emit gate.
 *
 * ARCHITECTURE NOTE (why this file exists)
 * ----------------------------------------
 * Before v3, correctness feedback was OPEN-loop: the model emitted files, a
 * long chain of deterministic repair passes tried to make them valid, and the
 * real verdict (`npm install` + `vite build`) only arrived from the remote
 * builder AFTER the turn had already been reported complete. The model never
 * saw a single diagnostic about its own output while it could still act on it,
 * so every new failure mode became repair pass #N+1 — an unbounded strategy.
 *
 * This gate closes the loop. It runs the deterministic verifiers we already
 * own (esbuild parse, local structural verifier, render-risk linter) and, when
 * they disagree with the model, feeds the EXACT diagnostics back for a bounded
 * number of repair rounds — inside the turn, before anything is emitted or
 * shipped to the builder.
 *
 * Contract:
 *   - Deterministic. Same files in, same verdict out (modulo the model round).
 *   - Bounded. `maxRounds` hard cap, plus an early exit when a round makes no
 *     progress (issue count did not drop) so we never burn budget spinning.
 *   - Non-destructive. If a repair round makes things WORSE, we keep the best
 *     state seen, never the regressed one.
 *   - Never throws. Verifier infrastructure failures degrade to "green" so an
 *     infra hiccup can't fail a turn that would otherwise have shipped.
 */

import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { verifyFilesLocal } from "@/server/local-verifier";
import { lintRenderRisks } from "@/server/render-risk-linter";
import { runPostStreamAutofix } from "@/server/post-stream-autofix.server";
import { isVerifierExempt } from "@/server/scaffold-ownership.server";
import type { ProjectFile } from "@/server/generate.server";
import type { Prd } from "@/server/prd/prd-types";

/** A diagnostic in the one shape every producer is normalized into. */
export interface GateIssue {
  path: string;
  kind: string;
  detail: string;
  /** Which verifier produced it — used for reporting and for severity. */
  source: "esbuild" | "local" | "render-risk" | "prd";
}

export interface PreEmitGateReport {
  /** True when the final state has no blocking issues. */
  ok: boolean;
  /** Model repair rounds actually spent (0 when the first check was green). */
  rounds: number;
  /** Blocking issues remaining in the returned files. */
  issues: GateIssue[];
  /** Human-readable trace, one line per round. Surfaced in build telemetry. */
  trace: string[];
  /** Issue count before any repair round ran. */
  initialIssueCount: number;
}

export interface PreEmitGateResult {
  files: ProjectFile[];
  report: PreEmitGateReport;
}

/**
 * Issue kinds that must never ship. Everything else is advisory: it is logged
 * and reported, but it does not hold the turn hostage.
 *
 * The split matters. A parse error guarantees a white screen; an optional-prop
 * render risk is a probability. Blocking on advisories would trade one bad
 * experience (broken preview) for another (turns that never finish).
 *
 * This is also, deliberately, the set of kinds the repair model is actually
 * able to act on. Blocking on a kind we cannot ask anyone to fix would just
 * burn every round and hard-stop for nothing.
 */
export const BLOCKING_KINDS = new Set([
  "parse",
  "truncation",
  "jsx",
  "braces",
  "unterminated-string",
  "undefined",
  "missing-sibling",
  "missing-export",
  "lazy-export",
  // The product contract. A build that compiles perfectly but does not contain
  // the product the user asked for is still a failed build.
  "prd-contract",
]);

/**
 * Scaffold-owned paths. Petal writes these, the model does not, so a
 * diagnostic here is either our bug or a false positive — never something a
 * repair round can resolve. Excluded from blocking for that reason.
 *
 * v3 Phase C — the list itself lives in `scaffold-ownership.server.ts` so the
 * write allowlist and the verifier exemptions can never drift apart.
 */
export function isScaffoldOwned(path: string): boolean {
  return isVerifierExempt(path);
}


export function isBlocking(issue: GateIssue): boolean {
  if (isScaffoldOwned(issue.path)) return false;
  if (issue.source === "esbuild") return true;
  return BLOCKING_KINDS.has(issue.kind);
}


/**
 * Run every deterministic verifier and normalize the results.
 *
 * Verifier failures are swallowed per-verifier rather than globally: a broken
 * render-risk linter should not blind us to a parse error.
 */
export async function collectGateIssues(
  files: ProjectFile[],
  changedPaths: string[],
  prd?: Prd | null,
): Promise<GateIssue[]> {
  const issues: GateIssue[] = [];

  // Product contract first. It is the cheapest check and the one whose failure
  // matters most — everything else verifies HOW the code is written, this
  // verifies WHETHER it is the product the user asked for.
  if (prd) {
    try {
      const { checkPrdStatically } = await import("@/server/prd/prd-acceptance.server");
      const result = checkPrdStatically(
        prd,
        files.map((f) => ({ path: f.path, content: f.content })),
      );
      const { recordPrdEvent } = await import("@/server/prd/prd-telemetry.server");
      recordPrdEvent({
        event: result.passed ? "gate-passed" : "gate-blocked",
        prd,
        failedCriteria: result.findings.filter((f) => f.severity === "blocking").map((f) => f.criterionId),
      });
      for (const f of result.findings) {
        if (f.severity !== "blocking") continue;
        issues.push({
          path: "src/routes/index.tsx",
          kind: "prd-contract",
          detail: `${f.message} → ${f.repairHint}`,
          source: "prd",
        });
      }
    } catch (e) {
      console.warn("[preemit-gate] PRD check errored, skipping:", e);
    }
  }


  try {
    const verdict = await verifyFilesEsbuild(files, changedPaths);
    for (const i of verdict.issues) {
      issues.push({
        path: i.path,
        kind: "parse",
        detail: `${i.message} (line ${i.line}:${i.column})`,
        source: "esbuild",
      });
    }
  } catch (e) {
    console.warn("[preemit-gate] esbuild verifier errored, skipping:", e);
  }

  try {
    const verdict = verifyFilesLocal(files, changedPaths);
    for (const i of verdict.issues) {
      issues.push({ path: i.path, kind: i.kind, detail: i.detail, source: "local" });
    }
  } catch (e) {
    console.warn("[preemit-gate] local verifier errored, skipping:", e);
  }

  try {
    for (const i of lintRenderRisks(files, changedPaths)) {
      issues.push({ path: i.path, kind: i.kind, detail: i.detail, source: "render-risk" });
    }
  } catch (e) {
    console.warn("[preemit-gate] render-risk linter errored, skipping:", e);
  }

  return dedupeIssues(issues);
}

/** Two verifiers routinely flag the same broken line. Report it once. */
function dedupeIssues(issues: GateIssue[]): GateIssue[] {
  const seen = new Set<string>();
  const out: GateIssue[] = [];
  for (const i of issues) {
    const key = `${i.path}::${i.kind}::${i.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

export function formatGateIssues(issues: GateIssue[], limit = 5): string {
  return issues
    .slice(0, limit)
    .map((i) => `${i.path} (${i.kind}): ${i.detail}`)
    .join("; ");
}

/**
 * The gate.
 *
 * @param files         Current project state (post deterministic repairs).
 * @param changedPaths  Paths this turn touched. Only these are verified —
 *                      pre-existing debt elsewhere is not this turn's problem.
 * @param opts.maxRounds        Hard cap on model repair rounds. Default 2.
 * @param opts.onRound          Progress callback so the caller can stream status.
 * @param opts.afterRepair      Hook to re-run deterministic repairs on the
 *                              model's output before the next verification.
 *                              Injected rather than imported so this module
 *                              stays free of the repair pipeline's ordering.
 */
export async function runPreEmitGate(
  files: ProjectFile[],
  changedPaths: string[],
  opts: {
    maxRounds?: number;
    onRound?: (round: number, issues: GateIssue[]) => void;
    afterRepair?: (files: ProjectFile[]) => ProjectFile[];
    /** Product contract for this turn. When present, it is verified too. */
    prd?: Prd | null;
  } = {},
): Promise<PreEmitGateResult> {
  const maxRounds = Math.max(0, opts.maxRounds ?? 2);

  let current = files;
  const trace: string[] = [];

  let issues = await collectGateIssues(current, changedPaths, opts.prd);
  let blocking = issues.filter(isBlocking);
  const initialIssueCount = blocking.length;

  // Best state seen so far. A repair round that regresses must never win.
  let bestFiles = current;
  let bestBlocking = blocking;

  trace.push(`round 0: ${blocking.length} blocking, ${issues.length - blocking.length} advisory`);

  let round = 0;
  while (blocking.length > 0 && round < maxRounds) {
    round += 1;
    opts.onRound?.(round, blocking);

    const before = blocking.length;
    let candidate: ProjectFile[];
    try {
      const out = await runPostStreamAutofix(
        current,
        blocking.map((i) => ({ path: i.path, kind: i.kind, detail: i.detail })),
      );
      candidate = out.files;
    } catch (e) {
      trace.push(`round ${round}: repair pass errored (${String(e)}) — stopping`);
      break;
    }

    // Verify the model's candidate before deterministic normalization. A
    // global repair pass must never be allowed to undo a fix that already
    // cleared the gate; that previously created an endless retry/rollback
    // cycle where every user retry reproduced the same failure.
    let nextIssues = await collectGateIssues(candidate, changedPaths, opts.prd);
    let nextBlocking = nextIssues.filter(isBlocking);

    if (opts.afterRepair) {
      try {
        const normalized = opts.afterRepair(candidate);
        const normalizedIssues = await collectGateIssues(normalized, changedPaths, opts.prd);
        const normalizedBlocking = normalizedIssues.filter(isBlocking);
        if (normalizedBlocking.length <= nextBlocking.length) {
          candidate = normalized;
          nextIssues = normalizedIssues;
          nextBlocking = normalizedBlocking;
        } else {
          trace.push(
            `round ${round}: deterministic repair regressed ${nextBlocking.length} -> ${normalizedBlocking.length}; kept model repair`,
          );
        }
      } catch (e) {
        console.warn("[preemit-gate] afterRepair hook errored, using unrepaired output:", e);
      }
    }

    if (nextBlocking.length < bestBlocking.length) {
      bestFiles = candidate;
      bestBlocking = nextBlocking;
    }

    trace.push(`round ${round}: ${before} -> ${nextBlocking.length} blocking`);

    // No progress means the model cannot see the problem. Another identical
    // round would cost the same and return the same. Stop.
    if (nextBlocking.length >= before) {
      trace.push(`round ${round}: no progress — stopping early`);
      current = bestFiles;
      issues = nextIssues;
      blocking = bestBlocking;
      break;
    }

    current = candidate;
    issues = nextIssues;
    blocking = nextBlocking;
  }

  // Always hand back the best state we ever saw, not the last one we tried.
  if (bestBlocking.length < blocking.length) {
    current = bestFiles;
    blocking = bestBlocking;
  }

  return {
    files: current,
    report: {
      ok: blocking.length === 0,
      rounds: round,
      issues: blocking,
      trace,
      initialIssueCount,
    },
  };
}
