/**
 * Repair ledger — AI Generation Bible §7.
 *
 * "Every repair records: error signature, fix applied, outcome. This is the
 * training set for new codemods."
 *
 * Before this module, `runAllRepairs()` computed `firedPasses` and threw it
 * away (it was only read by a unit test), and the only durable signal was a
 * daily aggregate digest. That is enough to notice a bad week and useless for
 * answering the question that actually matters: *which* broken shape does the
 * model keep re-emitting, and did our codemod actually make the build green?
 *
 * One row per (turn, pass). Best-effort: a ledger write must never break a
 * build, so every failure is swallowed after a console warning.
 */

export type RepairPhase =
  | "pre_build" // deterministic sweep before the artifact is handed to the builder
  | "autofix" // AI repair round after a failed validation gate
  | "watchdog" // stalled-build recovery path
  | "trigger"; // repair applied while assembling a build request

export type RepairOutcome = "applied" | "no_op" | "failed";

export interface RepairLedgerEntry {
  projectId: string | null;
  buildId?: string | null;
  userId?: string | null;
  phase: RepairPhase;
  /**
   * Stable id of the deterministic pass that fired (`shadcn-imports`,
   * `router-provider`, …) or the AI repair tier name. This is the join key
   * for "same pass, N turns running".
   */
  passId: string;
  /**
   * Normalized shape of the error being repaired. Free text is fine, but it
   * must be *stable across projects* — strip paths, line numbers and
   * identifiers before passing it in (see `signatureOf`).
   */
  signature: string;
  outcome: RepairOutcome;
  /** Human-readable detail. Truncated to 500 chars on write. */
  detail?: string | null;
}

/** Reduce a raw error string to a stable, cross-project signature. */
export function signatureOf(raw: string): string {
  return raw
    .slice(0, 400)
    .replace(/(^|\s)(\/|\.\/|src\/)[\w./@-]+/g, " <path>")
    .replace(/:\d+(:\d+)?/g, ":<n>")
    .replace(/'[^']{0,80}'/g, "'<id>'")
    .replace(/"[^"]{0,80}"/g, '"<id>"')
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hash>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Record a batch of repairs for one turn. Deduped by (passId, signature) so a
 * pass that fires on 12 files writes one row, not twelve.
 */
export async function recordRepairs(entries: RepairLedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const seen = new Set<string>();
    const rows = entries
      .filter((e) => {
        const k = `${e.passId}::${e.signature}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((e) => ({
        project_id: e.projectId,
        build_id: e.buildId ?? null,
        user_id: e.userId ?? null,
        phase: e.phase,
        pass_id: e.passId.slice(0, 80),
        signature: e.signature.slice(0, 200),
        outcome: e.outcome,
        detail: e.detail ? e.detail.slice(0, 500) : null,
      }));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("petal_repair_ledger").insert(rows as never);
    if (error) console.warn("[repair-ledger] insert failed:", error.message);
  } catch (e) {
    console.warn("[repair-ledger] skipped:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Convenience adapter for `runAllRepairs()` output: turns note lines
 * (`"<pass-id>: human text"`) into ledger entries.
 */
export function entriesFromRepairNotes(
  notes: string[],
  base: Omit<RepairLedgerEntry, "passId" | "signature" | "outcome" | "detail">,
): RepairLedgerEntry[] {
  const out: RepairLedgerEntry[] = [];
  for (const note of notes) {
    const m = /^([a-z0-9-]+):\s*(.*)$/i.exec(note.trim());
    if (!m) continue;
    out.push({
      ...base,
      passId: m[1].toLowerCase(),
      signature: signatureOf(m[2] || m[1]),
      outcome: "applied",
      detail: note,
    });
  }
  return out;
}
