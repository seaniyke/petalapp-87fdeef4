/**
 * Shared Cloud pause / resume — one authority for both pause reasons.
 *
 * A paused backend refuses sign-in, sign-up and data (402 `backend_paused`);
 * the published pages stay online. The two reasons are stored separately so
 * lifting one never lifts the other:
 *   - partner: `partner_paused` (set and cleared only through the partner API)
 *   - billing: `runtime_paused` (grace ran out; cleared when credits return)
 *
 * Every state change on a partner-owned site is pushed to the partner's
 * webhook (backend.grace_started / grace_ended / paused / resumed).
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PauseReason = "partner" | "billing";

type PauseRow = {
  partner_paused?: boolean | null;
  runtime_paused?: boolean | null;
  runtime_grace_until?: string | null;
};

/** Every reason a backend is paused, partner first. Empty = running. */
export function pauseReasonsOf(row: PauseRow): PauseReason[] {
  const out: PauseReason[] = [];
  if (row.partner_paused) out.push("partner");
  if (row.runtime_paused) out.push("billing");
  return out;
}

/** Single-field summary kept for older callers: "both" when both apply. */
export function pauseReasonOf(row: PauseRow): PauseReason | "both" | null {
  const r = pauseReasonsOf(row);
  if (r.length === 2) return "both";
  return r[0] ?? null;
}

export function isPaused(row: PauseRow): boolean {
  return pauseReasonsOf(row).length > 0;
}

/** Grace has run out: credits are still missing after the 48h window. */
export function graceExpired(graceUntil: string | null | undefined, now = Date.now()): boolean {
  return !!graceUntil && new Date(graceUntil).getTime() <= now;
}

export type BackendEvent = "backend.grace_started" | "backend.grace_ended" | "backend.paused" | "backend.resumed";

/** Webhook body for a backend state change. Pure, for tests. */
export function backendEventPayload(event: BackendEvent, projectId: string, row: PauseRow, at = new Date()) {
  return {
    event,
    projectId,
    paused: isPaused(row),
    pauseReason: pauseReasonOf(row),
    pauseReasons: pauseReasonsOf(row),
    graceUntil: row.runtime_grace_until ?? null,
    at: at.toISOString(),
  };
}

/**
 * Tell the partner about a backend state change on one of its sites.
 * Only partner-owned projects are reported; never throws.
 */
export async function notifyBackendChange(projectId: string, event: BackendEvent): Promise<void> {
  try {
    const { data: p } = await supabaseAdmin
      .from("projects")
      .select("owner_id, partner_paused, runtime_paused, runtime_grace_until")
      .eq("id", projectId)
      .maybeSingle();
    if (!p?.owner_id) return;
    const { serviceUserId, deliverWebhook } = await import("@/server/service-api.server");
    if (p.owner_id !== (await serviceUserId())) return;
    const { CUSTARD_DOMAIN_WEBHOOK } = await import("@/server/partner-domains.server");
    await deliverWebhook(CUSTARD_DOMAIN_WEBHOOK, backendEventPayload(event, projectId, p));
  } catch (e) {
    console.warn("[shared-cloud-pause] webhook skipped", projectId, e instanceof Error ? e.message : String(e));
  }
}

/** Set a pause flag; reports `paused` only when the site was running before. */
async function setFlag(projectId: string, patch: Partial<Record<"partner_paused" | "runtime_paused", boolean>> & { runtime_grace_until?: null }) {
  const { data: before } = await supabaseAdmin
    .from("projects")
    .select("partner_paused, runtime_paused")
    .eq("id", projectId)
    .maybeSingle();
  await supabaseAdmin.from("projects").update(patch).eq("id", projectId);
  const { data: after } = await supabaseAdmin
    .from("projects")
    .select("partner_paused, runtime_paused")
    .eq("id", projectId)
    .maybeSingle();
  const was = isPaused(before ?? {});
  const now = isPaused(after ?? {});
  if (!was && now) await notifyBackendChange(projectId, "backend.paused");
  else if (was && !now) await notifyBackendChange(projectId, "backend.resumed");
  else if (JSON.stringify(before) !== JSON.stringify(after)) {
    // Still paused, but the reasons changed (e.g. billing added to a partner pause).
    await notifyBackendChange(projectId, now ? "backend.paused" : "backend.resumed");
  }
}

export async function pauseForPartner(projectId: string): Promise<void> {
  await setFlag(projectId, { partner_paused: true });
}

/** Lifts only the partner's own pause; a billing pause stays. */
export async function resumeForPartner(projectId: string): Promise<void> {
  await setFlag(projectId, { partner_paused: false });
}

export async function pauseForBilling(projectId: string): Promise<void> {
  await setFlag(projectId, { runtime_paused: true });
}

/** Credits are back: lifts only the billing pause; a partner pause stays. */
export async function resumeFromBilling(projectId: string): Promise<void> {
  await setFlag(projectId, { runtime_paused: false, runtime_grace_until: null });
}
