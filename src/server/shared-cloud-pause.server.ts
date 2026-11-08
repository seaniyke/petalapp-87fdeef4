/**
 * Shared Cloud pause / resume — one authority for both pause reasons.
 *
 * A paused backend refuses sign-in, sign-up and data (402 `backend_paused`);
 * the published pages stay online. Reason is derived, no extra column:
 *   - billing: `runtime_paused` AND `runtime_grace_until` set (grace ran out)
 *   - partner: `runtime_paused` AND no grace (paused on request)
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PauseReason = "partner" | "billing" | null;

export function pauseReasonOf(row: { runtime_paused?: boolean | null; runtime_grace_until?: string | null }): PauseReason {
  if (!row.runtime_paused) return null;
  return row.runtime_grace_until ? "billing" : "partner";
}

/** Grace has run out: credits are still missing after the 48h window. */
export function graceExpired(graceUntil: string | null | undefined, now = Date.now()): boolean {
  return !!graceUntil && new Date(graceUntil).getTime() <= now;
}

export async function pauseForPartner(projectId: string): Promise<void> {
  await supabaseAdmin.from("projects").update({ runtime_paused: true }).eq("id", projectId);
}

export async function pauseForBilling(projectId: string): Promise<void> {
  // Keeps runtime_grace_until set so the reason reads as "billing".
  await supabaseAdmin.from("projects").update({ runtime_paused: true }).eq("id", projectId);
}

export async function resumeBackend(projectId: string): Promise<void> {
  await supabaseAdmin
    .from("projects")
    .update({ runtime_paused: false, runtime_grace_until: null })
    .eq("id", projectId);
}
