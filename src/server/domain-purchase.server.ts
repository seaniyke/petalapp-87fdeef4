/**
 * Domain-purchase orchestration.
 *
 * Two entry points:
 *
 *   1. startDomainRegistration(reference) — called from the Paystack webhook
 *      right after we know the user paid. Kicks off Cloudflare's async
 *      registration workflow and stores the workflow ID + state.
 *
 *   2. pollDomainRegistration(rowId | hostname) — called from the poll route
 *      and our background reconciler. Polls Cloudflare's
 *      /registration-status endpoint until terminal, then either:
 *        - succeeded → point the new zone at SaaS, register the SaaS custom
 *                      hostname, mark the row active, link it to project_domains
 *        - failed / blocked / action_required → store the error
 *
 * Idempotent: safe to call repeatedly; uses the row's `status` to short-circuit.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  registerDomain,
  registrationStatus,
  type CfRegistrationWorkflow,
} from "@/server/cloudflare-registrar.server";
import { pointZoneAtSaas } from "@/server/cloudflare-zones.server";
import { createCustomHostname } from "@/server/cloudflare-saas.server";

type Row = {
  id: string;
  hostname: string;
  project_id: string;
  user_id: string;
  wholesale_cost_cents: number;
  status: string;
  cf_registration_id: string | null;
  cf_registration_resource_link: string | null;
  cf_state: string | null;
  connected_domain_id: string | null;
};

const SELECT_COLS =
  "id, hostname, project_id, user_id, wholesale_cost_cents, status, cf_registration_id, cf_registration_resource_link, cf_state, connected_domain_id";

async function loadByReference(reference: string): Promise<Row | null> {
  const { data } = await supabaseAdmin
    .from("purchased_domains")
    .select(SELECT_COLS)
    .eq("paystack_reference", reference)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

async function loadById(id: string): Promise<Row | null> {
  const { data } = await supabaseAdmin
    .from("purchased_domains")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * Step 1 — kick off the Cloudflare registration after a successful payment.
 * Webhook calls this fire-and-forget; if it throws we log + leave the row
 * in `registering` for the poller to recover.
 */
export async function startDomainRegistration(args: {
  reference: string;
}): Promise<void> {
  const row = await loadByReference(args.reference);
  if (!row) {
    console.error("[domain] startDomainRegistration: missing row", args.reference);
    return;
  }
  if (row.status === "active" || row.status === "polling") return;

  await supabaseAdmin
    .from("purchased_domains")
    .update({ status: "registering" })
    .eq("id", row.id);

  let workflow: CfRegistrationWorkflow;
  try {
    workflow = await registerDomain({
      hostname: row.hostname,
      expectedWholesaleCents: row.wholesale_cost_cents,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Registration kickoff failed";
    console.error("[domain] register kickoff failed", row.hostname, e);
    await supabaseAdmin
      .from("purchased_domains")
      .update({ status: "failed", error_message: msg })
      .eq("id", row.id);
    return;
  }

  await supabaseAdmin
    .from("purchased_domains")
    .update({
      status: "polling",
      cf_state: workflow.state,
      cf_registration_id:
        workflow.context?.registration?.domain_name ?? workflow.domain_name,
      cf_registration_resource_link: workflow.links?.resource ?? null,
      last_polled_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  // If CF answered synchronously, finish the job immediately.
  if (workflow.completed) {
    await pollDomainRegistration({ rowId: row.id });
  }
}

/**
 * Step 2 — poll Cloudflare for the latest workflow state and act on it.
 * Safe to call concurrently; conditional updates prevent double-finishing.
 */
export async function pollDomainRegistration(args: {
  rowId: string;
}): Promise<{ status: string }> {
  const row = await loadById(args.rowId);
  if (!row) return { status: "missing" };
  if (row.status === "active" && row.connected_domain_id) return { status: "active" };
  if (row.status === "failed" || row.status === "expired") {
    return { status: row.status };
  }
  if (row.status === "pending_payment") return { status: row.status };

  let workflow: CfRegistrationWorkflow;
  try {
    workflow = await registrationStatus(row.hostname);
  } catch (e) {
    console.error("[domain] poll status failed", row.hostname, e);
    await supabaseAdmin
      .from("purchased_domains")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("id", row.id);
    return { status: row.status };
  }

  // Persist the latest state regardless of terminal-ness.
  await supabaseAdmin
    .from("purchased_domains")
    .update({
      cf_state: workflow.state,
      last_polled_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (workflow.state === "succeeded") {
    return finalizeSuccess(row, workflow);
  }
  if (
    workflow.state === "failed" ||
    workflow.state === "blocked" ||
    workflow.state === "action_required"
  ) {
    const msg =
      workflow.error?.message ??
      (workflow.state === "action_required"
        ? "Cloudflare needs additional action — contact support."
        : `Registration ${workflow.state}`);
    await supabaseAdmin
      .from("purchased_domains")
      .update({ status: "failed", error_message: msg })
      .eq("id", row.id);
    return { status: "failed" };
  }

  // in_progress — keep polling.
  return { status: row.status };
}

type ProjectDomainLink = { id: string; provider_hostname_id: string | null };

async function ensureProjectDomainRow(row: Row): Promise<ProjectDomainLink | null> {
  if (row.connected_domain_id) {
    const { data } = await supabaseAdmin
      .from("project_domains")
      .select("id, provider_hostname_id")
      .eq("id", row.connected_domain_id)
      .maybeSingle();
    if (data) return data as ProjectDomainLink;
  }

  const { data: existing } = await supabaseAdmin
    .from("project_domains")
    .select("id, provider_hostname_id")
    .eq("hostname", row.hostname)
    .maybeSingle();
  if (existing) return existing as ProjectDomainLink;

  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .insert({
      project_id: row.project_id,
      hostname: row.hostname,
      status: "verifying",
      ssl_status: "initializing",
      provider_hostname_id: null,
      verification_txt_name: `_purchased.${row.hostname}`,
      verification_txt_value: "Petal-managed — no DNS changes needed",
      verification_records: [],
      last_checked_at: new Date().toISOString(),
      error_message: "Domain registered; connection setup is finishing automatically.",
    })
    .select("id, provider_hostname_id")
    .single();

  if (error) {
    console.error("[domain] placeholder project_domain failed", row.hostname, error);
    return null;
  }
  return data as ProjectDomainLink;
}

async function finalizeSuccess(
  row: Row,
  workflow: CfRegistrationWorkflow,
): Promise<{ status: string }> {
  if (row.status === "active" && row.connected_domain_id) return { status: "active" };

  const reg = workflow.context?.registration;
  const projectDomain = await ensureProjectDomainRow(row);

  // Step A: point the newly-created zone at our SaaS edge.
  let zoneOk = false;
  let setupError: string | null = null;
  try {
    await pointZoneAtSaas({ hostname: row.hostname });
    zoneOk = true;
  } catch (e) {
    setupError = e instanceof Error ? e.message : "Zone setup failed";
    console.error("[domain] pointZoneAtSaas failed", row.hostname, e);
  }

  // Step B: register the hostname on our SaaS zone so traffic routes to the project.
  let providerHostnameId: string | null = projectDomain?.provider_hostname_id ?? null;
  if (zoneOk && projectDomain && !providerHostnameId) {
    try {
      const cfHostname = await createCustomHostname(row.hostname, { sslMethod: "http" });
      providerHostnameId = cfHostname.id;
      await supabaseAdmin
        .from("project_domains")
        .update({
          status: "verifying",
          ssl_status: cfHostname.ssl?.status ?? "initializing",
          provider_hostname_id: providerHostnameId,
          verification_txt_name: `_purchased.${row.hostname}`,
          verification_txt_value: "Petal-managed — no DNS changes needed",
          verification_records: [],
          error_message: null,
          last_checked_at: new Date().toISOString(),
        })
        .eq("id", projectDomain.id);
    } catch (e) {
      setupError = e instanceof Error ? e.message : "Custom hostname setup failed";
      console.error("[domain] createCustomHostname failed", row.hostname, e);
    }
  }

  if (projectDomain && !providerHostnameId) {
    await supabaseAdmin
      .from("project_domains")
      .update({
        status: "verifying",
        ssl_status: "initializing",
        error_message: `Domain registered; connection setup pending${setupError ? `: ${setupError}` : ""}`,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", projectDomain.id);
  }

  await supabaseAdmin
    .from("purchased_domains")
    .update({
      status: providerHostnameId ? "active" : "polling",
      cf_state: "succeeded",
      registered_at: reg?.created_at ?? new Date().toISOString(),
      expires_at: reg?.expires_at ?? null,
      auto_renew: reg?.auto_renew ?? false,
      connected_domain_id: projectDomain?.id ?? null,
      error_message: providerHostnameId
        ? null
        : `Domain registered; connection setup pending${setupError ? `: ${setupError}` : ""}`,
    })
    .eq("id", row.id);

  return { status: providerHostnameId ? "active" : "polling" };
}

/**
 * Reconciler — used by the poll route and any future cron. Picks up rows
 * that are in `registering` or `polling` and haven't been checked recently.
 */
export async function reconcilePendingRegistrations(args: {
  staleSeconds?: number;
  limit?: number;
} = {}): Promise<{ checked: number }> {
  const stale = new Date(Date.now() - (args.staleSeconds ?? 30) * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("purchased_domains")
    .select("id")
    .in("status", ["registering", "polling"])
    .or(`last_polled_at.is.null,last_polled_at.lt.${stale}`)
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(args.limit ?? 10);

  for (const r of rows ?? []) {
    await pollDomainRegistration({ rowId: (r as { id: string }).id }).catch((e) =>
      console.error("[domain] reconcile failed", r, e),
    );
  }
  return { checked: rows?.length ?? 0 };
}
