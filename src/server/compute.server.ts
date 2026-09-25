/**
 * Kimble Compute — an isolated container per project.
 *
 * The third Kimble Cloud tier. Used only when an app genuinely needs a server
 * we control: long-running work, background jobs, websockets, media
 * processing, or a runtime that isn't JavaScript-on-the-edge.
 *
 * Rules that must never be broken:
 *   - A compute failure never takes a running app offline. Every failure path
 *     leaves the project exactly where it was, on its current tier.
 *   - Nothing is provisioned for a user who can't fund it, and never beyond
 *     Kimble's own capacity ceiling.
 *   - A sleeping container is never billed.
 *
 * Server-only.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValue } from "@/server/economics-config.server";
import { getAccessState } from "@/server/entitlements.server";
import {
  createService,
  createServiceDomain,
  deleteService,
  latestDeployment,
  readComputeConfig,
  redeployService,
  setServiceVariables,
} from "@/server/railway.server";

export type ComputeStatus = "pending" | "ready" | "sleeping" | "failed" | "deleted";

export type ComputeRecord = {
  projectId: string;
  status: ComputeStatus;
  serviceUrl: string | null;
  serviceId: string | null;
  awakeSince: string | null;
  lastActiveAt: string | null;
  errorMessage: string | null;
};

/** How long a container may sit idle before it is put to sleep. */
export const COMPUTE_IDLE_MS = 30 * 60 * 1000;
/** Abandoned containers are removed after this long asleep. */
export const COMPUTE_REAP_MS = 14 * 24 * 60 * 60 * 1000;

function toRecord(row: Record<string, unknown>): ComputeRecord {
  return {
    projectId: String(row["project_id"]),
    status: (row["status"] as ComputeStatus) ?? "pending",
    serviceUrl: (row["service_url"] as string) ?? null,
    serviceId: (row["service_id"] as string) ?? null,
    awakeSince: (row["awake_since"] as string) ?? null,
    lastActiveAt: (row["last_active_at"] as string) ?? null,
    errorMessage: (row["error_message"] as string) ?? null,
  };
}

export async function getCompute(projectId: string): Promise<ComputeRecord | null> {
  const { data } = await supabaseAdmin
    .from("project_compute")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  return data ? toRecord(data as Record<string, unknown>) : null;
}

export type ProvisionResult =
  | { ok: true; compute: ComputeRecord }
  | { ok: false; reason: "not_configured" | "not_entitled" | "at_capacity" | "failed"; message: string };

/**
 * Give a project its own container. Idempotent — an existing live record is
 * returned untouched.
 */
export async function provisionCompute(opts: {
  projectId: string;
  ownerId: string;
  /** Container image to run. Defaults to the project's own generated server image. */
  image?: string;
  env?: Record<string, string>;
}): Promise<ProvisionResult> {
  const existing = await getCompute(opts.projectId);
  if (existing && existing.status !== "deleted" && existing.status !== "failed") {
    return { ok: true, compute: existing };
  }

  const cfg = readComputeConfig();
  if (cfg.missing.length) {
    return {
      ok: false,
      reason: "not_configured",
      message: `Kimble Compute is not configured (${cfg.missing.join(", ")}).`,
    };
  }

  const access = await getAccessState(opts.ownerId);
  if (!access.hasFullAccess) {
    return {
      ok: false,
      reason: "not_entitled",
      message: "Credits are needed to run a dedicated server.",
    };
  }

  const ceiling = await economicsValue("max_active_compute");
  const { count } = await supabaseAdmin
    .from("project_compute")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "ready", "sleeping"]);
  if ((count ?? 0) >= ceiling) {
    return {
      ok: false,
      reason: "at_capacity",
      message: "Kimble is at capacity for dedicated servers right now. Try again shortly.",
    };
  }

  const name = `kimble-${opts.projectId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
  await supabaseAdmin.from("project_compute").upsert(
    {
      project_id: opts.projectId,
      owner_id: opts.ownerId,
      status: "pending",
      error_message: null,
    } as never,
    { onConflict: "project_id" },
  );

  try {
    const image = opts.image ?? process.env["RAILWAY_COMPUTE_DEFAULT_IMAGE"] ?? "";
    if (!image) throw new Error("no compute image configured");
    const service = await createService(cfg, name, { image });
    if (opts.env && Object.keys(opts.env).length) {
      await setServiceVariables(cfg, service.id, opts.env);
    }
    const url = await createServiceDomain(cfg, service.id);
    const now = new Date().toISOString();
    const { data } = await supabaseAdmin
      .from("project_compute")
      .update({
        status: "ready",
        service_id: service.id,
        environment_id: cfg.environmentId,
        service_url: url,
        awake_since: now,
        last_active_at: now,
        billed_through: now,
        error_message: null,
      } as never)
      .eq("project_id", opts.projectId)
      .select("*")
      .maybeSingle();
    return { ok: true, compute: toRecord((data ?? {}) as Record<string, unknown>) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[compute] provision failed", opts.projectId, err);
    await supabaseAdmin
      .from("project_compute")
      .update({ status: "failed", error_message: message.slice(0, 500) } as never)
      .eq("project_id", opts.projectId);
    return { ok: false, reason: "failed", message };
  }
}

/** Mark a container as used right now, waking it if it was asleep. */
export async function touchCompute(projectId: string): Promise<void> {
  const record = await getCompute(projectId);
  if (!record || record.status === "deleted" || record.status === "failed") return;
  const now = new Date().toISOString();
  if (record.status === "sleeping") {
    const cfg = readComputeConfig();
    if (!cfg.missing.length && record.serviceId) {
      try {
        await redeployService(cfg, record.serviceId);
      } catch (err) {
        console.warn("[compute] wake failed", projectId, err);
        return;
      }
    }
    await supabaseAdmin
      .from("project_compute")
      .update({ status: "ready", awake_since: now, last_active_at: now, billed_through: now } as never)
      .eq("project_id", projectId);
    return;
  }
  await supabaseAdmin
    .from("project_compute")
    .update({ last_active_at: now } as never)
    .eq("project_id", projectId);
}

export async function sleepCompute(projectId: string): Promise<void> {
  const record = await getCompute(projectId);
  if (!record || record.status !== "ready") return;
  await supabaseAdmin
    .from("project_compute")
    .update({ status: "sleeping", awake_since: null } as never)
    .eq("project_id", projectId);
}

export async function destroyCompute(projectId: string): Promise<void> {
  const record = await getCompute(projectId);
  if (!record || !record.serviceId) return;
  const cfg = readComputeConfig();
  if (!cfg.missing.length) {
    try {
      await deleteService(cfg, record.serviceId);
    } catch (err) {
      console.warn("[compute] delete failed", projectId, err);
    }
  }
  await supabaseAdmin
    .from("project_compute")
    .update({ status: "deleted", awake_since: null, service_url: null } as never)
    .eq("project_id", projectId);
}

/** Live deployment state, for the Cloud panel. Never throws. */
export async function computeHealth(projectId: string): Promise<string | null> {
  const record = await getCompute(projectId);
  if (!record?.serviceId) return null;
  const cfg = readComputeConfig();
  if (cfg.missing.length) return null;
  try {
    return (await latestDeployment(cfg, record.serviceId))?.status ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Hourly metering
 * ------------------------------------------------------------------ */

export type ComputeBillingRow = {
  projectId: string;
  ownerId: string;
  awakeSince: string | null;
  billedThrough: string | null;
  lastActiveAt: string | null;
};

/** Containers currently awake — the only ones that can be billed. */
export async function listBillableCompute(): Promise<ComputeBillingRow[]> {
  const { data } = await supabaseAdmin
    .from("project_compute")
    .select("project_id, owner_id, awake_since, billed_through, last_active_at")
    .eq("status", "ready");
  return (data ?? []).map((r) => ({
    projectId: String(r.project_id),
    ownerId: String(r.owner_id),
    awakeSince: r.awake_since as string | null,
    billedThrough: r.billed_through as string | null,
    lastActiveAt: r.last_active_at as string | null,
  }));
}

/** Whole hours of uptime owed since the last settlement. Never negative. */
export function hoursOwed(row: ComputeBillingRow, nowMs = Date.now()): number {
  const fromIso = row.billedThrough ?? row.awakeSince;
  if (!fromIso) return 0;
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / 3_600_000));
}

export async function markBilled(projectId: string, hours: number, fromIso: string): Promise<void> {
  const next = new Date(Date.parse(fromIso) + hours * 3_600_000).toISOString();
  await supabaseAdmin
    .from("project_compute")
    .update({ billed_through: next } as never)
    .eq("project_id", projectId);
}

/** Cents charged per awake hour, from central config. */
export async function computeHourCents(): Promise<number> {
  const usd = await economicsValue("compute_hour_usd");
  return Math.max(1, Math.round(usd * 100));
}
