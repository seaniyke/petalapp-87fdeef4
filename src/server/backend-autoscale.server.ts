/**
 * Automatic database upgrade.
 *
 * Every generated app starts on Petal's shared database because that costs
 * us almost nothing and covers any early-stage app. When an app actually
 * grows — real rows, real signed-up users — or needs something the shared
 * tier can't do, Petal moves it onto its own database without the owner
 * having to understand the difference.
 *
 * Rules that must never be broken:
 *   - An upgrade never breaks a running app. Every failure path leaves the
 *     app exactly where it was, serving its data.
 *   - An upgrade is never silent. The owner is told, with the cost, and can
 *     opt out.
 *   - An upgrade is never free money. It is gated on the owner's credits and
 *     on Petal's own capacity ceiling.
 *
 * Server-only. Never import from client code.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValue } from "@/server/economics-config.server";
import {
  activeManagedCount,
  ensureUpstreamProjectRef,
  provisionForProject,
} from "@/server/managed-backend.server";
import {
  clearSharedCopy,
  copySharedDataToDedicated,
  ensureDedicatedSchema,
  invalidateStore,
  storeFor,
  verifyCopy,
} from "@/server/project-store.server";
import { SHARED_LIMITS } from "@/server/shared-backend.server";

export type UpgradeReason = "rows" | "users" | "capability";

export type UpgradeDecision =
  | { upgrade: true; reason: UpgradeReason; rows: number; users: number }
  | {
      upgrade: false;
      blocked: null | "opted_out" | "no_credits" | "at_capacity" | "not_shared";
      rows: number;
      users: number;
    };

/** Paid plans and purchased credits both count as "can fund a database". */
const PAID_PLAN_CODES = new Set(["pro", "business", "starter_pro", "start_business"]);

async function recordEvent(
  projectId: string,
  reason: string,
  status: string,
  detail: string | null,
  counts: { rows: number; users: number },
): Promise<void> {
  try {
    await supabaseAdmin.from("project_upgrade_events").insert({
      project_id: projectId,
      reason,
      status,
      detail: detail ? detail.slice(0, 1000) : null,
      rows_count: counts.rows,
      users_count: counts.users,
    });
  } catch (err) {
    console.warn("[autoscale] event write failed", projectId, err);
  }
}

/** Current shared-tier size for a project. */
export async function sharedFootprint(
  projectId: string,
): Promise<{ rows: number; users: number }> {
  const [{ count: rows }, { count: users }] = await Promise.all([
    supabaseAdmin
      .from("shared_app_records")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabaseAdmin
      .from("shared_app_users")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
  ]);
  return { rows: rows ?? 0, users: users ?? 0 };
}

/** Does the owner have enough credits to fund a database, with a buffer? */
export async function ownerCanFund(ownerId: string): Promise<boolean> {
  const { data: wallet } = await supabaseAdmin
    .from("user_wallets")
    .select("plan_code, topup_credits_remaining, monthly_credits_remaining")
    .eq("user_id", ownerId)
    .maybeSingle();
  const planCode = String(wallet?.plan_code ?? "free");
  const topup = Number(wallet?.topup_credits_remaining ?? 0);
  const total = topup + Number(wallet?.monthly_credits_remaining ?? 0);
  const hasAccess = PAID_PLAN_CODES.has(planCode) || topup > 0;
  if (!hasAccess) return false;
  const minCredits = await economicsValue("auto_upgrade_min_credits");
  return total >= minCredits;
}

/**
 * Should this shared-tier project be moved onto its own database?
 *
 * `capability` short-circuits the size thresholds: an app that needs file
 * storage or direct SQL needs a real database regardless of how small it is.
 */
export async function evaluateProject(
  projectId: string,
  capability = false,
): Promise<UpgradeDecision> {
  const { data: project } = await supabaseAdmin
    .from("projects")
    .select("owner_id, backend_type, auto_upgrade_opt_out")
    .eq("id", projectId)
    .maybeSingle();

  const counts = await sharedFootprint(projectId);

  if (!project || project.backend_type !== "shared") {
    return { upgrade: false, blocked: "not_shared", ...counts };
  }
  if (project.auto_upgrade_opt_out) {
    return { upgrade: false, blocked: "opted_out", ...counts };
  }

  // An existing backend row means a database is already attached or on its way.
  const { data: existing } = await supabaseAdmin
    .from("project_backends")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existing) return { upgrade: false, blocked: "not_shared", ...counts };

  const rowPct = await economicsValue("auto_upgrade_row_pct");
  const userCap = await economicsValue("auto_upgrade_user_count");
  const rowTrigger = Math.ceil((SHARED_LIMITS.maxRowsPerProject * rowPct) / 100);

  let reason: UpgradeReason | null = null;
  if (capability) reason = "capability";
  else if (counts.rows >= rowTrigger) reason = "rows";
  else if (counts.users >= userCap) reason = "users";
  if (!reason) return { upgrade: false, blocked: null, ...counts };

  if (!project.owner_id || !(await ownerCanFund(project.owner_id))) {
    return { upgrade: false, blocked: "no_credits", ...counts };
  }

  const maxActive = await economicsValue("max_active_dedicated_backends");
  if ((await activeManagedCount()) >= maxActive) {
    return { upgrade: false, blocked: "at_capacity", ...counts };
  }

  return { upgrade: true, reason, ...counts };
}

/* ---------------- the upgrade itself ---------------- */

export type UpgradeResult = {
  ok: boolean;
  rows: number;
  users: number;
  error?: string;
};

/**
 * Move a project from the shared database onto its own.
 *
 * On ANY failure the project is put back on shared and nothing is lost — the
 * shared copy is only cleared after the dedicated copy is verified.
 */
export async function upgradeProject(
  projectId: string,
  reason: UpgradeReason,
): Promise<UpgradeResult> {
  const counts = await sharedFootprint(projectId);

  const { error: insertErr } = await supabaseAdmin.from("project_backends").insert({
    project_id: projectId,
    provider: "managed_petal",
    status: "provisioning",
    supabase_url: "",
    anon_key: "",
    provisioning_started_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
  });
  if (insertErr) {
    await recordEvent(projectId, reason, "failed", insertErr.message, counts);
    return { ok: false, ...counts, error: insertErr.message };
  }

  await supabaseAdmin
    .from("projects")
    .update({ backend_type: "dedicated" })
    .eq("id", projectId);

  const rollback = async (msg: string): Promise<UpgradeResult> => {
    await supabaseAdmin.from("project_backends").delete().eq("project_id", projectId);
    await supabaseAdmin
      .from("projects")
      .update({ backend_type: "shared" })
      .eq("id", projectId);
    invalidateStore(projectId);
    await recordEvent(projectId, reason, "failed", msg, counts);
    return { ok: false, ...counts, error: msg };
  };

  try {
    const ref = await ensureUpstreamProjectRef(projectId);
    await provisionForProject(projectId);
    if (!ref) return await rollback("no upstream project ref");

    await ensureDedicatedSchema(ref);

    invalidateStore(projectId);
    const target = await storeFor(projectId);
    if (!target.dedicated) return await rollback("dedicated store not ready");

    const copied = await copySharedDataToDedicated(projectId, target);
    if (!(await verifyCopy(projectId, target, copied))) {
      return await rollback("copy verification failed");
    }
    await clearSharedCopy(projectId);
    invalidateStore(projectId);

    await recordEvent(projectId, reason, "upgraded", null, copied);
    await notifyOwner(projectId, reason);
    return { ok: true, ...copied };
  } catch (e) {
    return await rollback(e instanceof Error ? e.message : String(e));
  }
}

/* ---------------- telling the owner ---------------- */

const REASON_TEXT: Record<UpgradeReason, string> = {
  rows: "it's storing a lot of data now",
  users: "it has real people signing up now",
  capability: "it needs features the starter database doesn't have",
};

/** Tell the owner their app was moved, with the cost and a way to opt out. */
export async function notifyOwner(
  projectId: string,
  reason: UpgradeReason,
): Promise<boolean> {
  try {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("title, owner_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project?.owner_id) return false;
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", project.owner_id)
      .maybeSingle();
    const email = (profile as { email?: string } | null)?.email;
    if (!email) return false;
    const title = project.title ?? "Your app";

    const body =
      `${title} has grown — ${REASON_TEXT[reason]} — so Petal moved it onto its own database.\n\n` +
      `Everything carried across and the app kept running throughout. ` +
      `A dedicated database uses your credits while it's active, and it sleeps on its own when the app is quiet.\n\n` +
      `If you'd rather stay on the starter database, open the app's settings and turn off automatic upgrades.`;

    await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: `backend-upgrade-${projectId}`,
        to: email,
        from: "Petal AI <noreply@buildwithpetal.com>",
        sender_domain: "notify.buildwithpetal.com",
        subject: `${title} moved onto its own database`,
        html: `<p>${body.replace(/\n\n/g, "</p><p>")}</p>`,
        text: body,
        purpose: "transactional",
        label: "backend_auto_upgrade",
        idempotency_key: `backend-upgrade-${projectId}`,
        queued_at: new Date().toISOString(),
      },
    });
    await supabaseAdmin
      .from("projects")
      .update({ auto_upgrade_notified_at: new Date().toISOString() })
      .eq("id", projectId);
    return true;
  } catch (err) {
    console.warn("[autoscale] notify failed", projectId, err);
    return false;
  }
}

/* ---------------- entry points ---------------- */

/**
 * Evaluate one project and upgrade it when it qualifies. Used by the daily
 * watcher and by capability-triggered upgrades. Never throws.
 */
export async function considerUpgrade(
  projectId: string,
  capability = false,
): Promise<{ upgraded: boolean; blocked?: string; error?: string }> {
  try {
    const decision = await evaluateProject(projectId, capability);
    if (!decision.upgrade) {
      if (decision.blocked === "no_credits" || decision.blocked === "at_capacity") {
        await recordEvent(projectId, capability ? "capability" : "growth", "blocked", decision.blocked, {
          rows: decision.rows,
          users: decision.users,
        });
      }
      return { upgraded: false, blocked: decision.blocked ?? undefined };
    }
    const result = await upgradeProject(projectId, decision.reason);
    return result.ok ? { upgraded: true } : { upgraded: false, error: result.error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[autoscale] considerUpgrade failed", projectId, msg);
    return { upgraded: false, error: msg };
  }
}

export type WatchSummary = {
  checked: number;
  upgraded: number;
  blocked: number;
  errors: number;
};

/**
 * Daily growth watcher: score every shared-tier app and upgrade the ones that
 * have outgrown it. Bounded per run so one sweep can never hog capacity.
 */
export async function runGrowthWatcher(limit = 10): Promise<WatchSummary> {
  const summary: WatchSummary = { checked: 0, upgraded: 0, blocked: 0, errors: 0 };

  const { data: projects, error } = await supabaseAdmin
    .from("projects")
    .select("id")
    .eq("backend_type", "shared")
    .eq("auto_upgrade_opt_out", false);
  if (error) throw new Error(`list shared projects: ${error.message}`);

  // Apps that asked for something the starter database can't do (file
  // storage, direct SQL) jump the size thresholds.
  const pending = new Set<string>();
  const { data: requests } = await supabaseAdmin
    .from("project_upgrade_events")
    .select("project_id")
    .eq("status", "requested")
    .order("created_at", { ascending: false })
    .limit(200);
  for (const r of requests ?? []) pending.add(r.project_id as string);

  for (const p of projects ?? []) {
    if (summary.upgraded >= limit) break;
    summary.checked++;
    const result = await considerUpgrade(p.id, pending.has(p.id));
    if (result.upgraded) summary.upgraded++;
    else if (result.error) summary.errors++;
    else if (result.blocked) summary.blocked++;
  }

  return summary;
}

/**
 * Note that an app asked for something the starter database can't do.
 *
 * Provisioning takes minutes, so we never do it inside a chat turn. The
 * request is recorded and the watcher picks it up on its next sweep, ahead
 * of the size thresholds. Best-effort — a failure here never affects the turn.
 */
export async function requestCapabilityUpgrade(
  projectId: string,
  capability: string,
): Promise<void> {
  try {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("backend_type, auto_upgrade_opt_out")
      .eq("id", projectId)
      .maybeSingle();
    if (!project || project.backend_type !== "shared" || project.auto_upgrade_opt_out) return;

    // Don't pile up duplicates for the same app.
    const { data: existing } = await supabaseAdmin
      .from("project_upgrade_events")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "requested")
      .limit(1);
    if (existing && existing.length > 0) return;

    await supabaseAdmin.from("project_upgrade_events").insert({
      project_id: projectId,
      reason: "capability",
      status: "requested",
      detail: capability.slice(0, 200),
    });
  } catch (err) {
    console.warn("[autoscale] capability request failed", projectId, err);
  }
}

/** Clear a satisfied capability request. */
export async function clearCapabilityRequests(projectId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("project_upgrade_events")
      .delete()
      .eq("project_id", projectId)
      .eq("status", "requested");
  } catch {
    /* best-effort */
  }
}
