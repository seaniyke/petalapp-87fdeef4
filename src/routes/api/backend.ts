/**
 * BYO backend connector — HTTP endpoints.
 *
 * v1 of the hybrid backend story: lets a user attach an existing Supabase
 * project to one of their Petal projects. v2 will add a managed provisioner
 * that writes to the same `project_backends` table with a different `provider`.
 * Generated apps and downstream code are unchanged — that's the point.
 *
 * Routes:
 *   POST /api/backend?action=status      -> get current backend (no service_role)
 *   POST /api/backend?action=connect     -> connect a BYO Supabase project
 *   POST /api/backend?action=disconnect  -> remove the connection
 *
 * All actions require a Bearer token and verify project ownership.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  provisionForProject,
  refreshStatus,
  restoreForProject,
} from "@/server/managed-backend.server";

/**
 * Plans that gate access to managed backend / email / domains. Free users
 * are routed to upgrade instead of being asked to top up Cloud.
 */
const PAID_PLAN_CODES = new Set(["pro", "business"]);

const SUPABASE_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i;

const ConnectInput = z.object({
  projectId: z.string().uuid(),
  supabaseUrl: z
    .string()
    .trim()
    .regex(SUPABASE_URL_RE, "Must look like https://xxx.supabase.co"),
  anonKey: z.string().trim().min(20, "Anon key looks too short"),
  serviceRoleKey: z.string().trim().min(20).optional().or(z.literal("")),
});

const ProjectIdInput = z.object({ projectId: z.string().uuid() });

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

async function assertOwnsProject(projectId: string, userId: string): Promise<Response | null> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return new Response("Project not found", { status: 404 });
  if (data.owner_id !== userId) return new Response("Forbidden", { status: 403 });
  return null;
}

function normalizeUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

async function handleStatus(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;
  const { data, error } = await supabaseAdmin
    .from("project_backends")
    .select(
      "status, provider, supabase_url, anon_key, error_message, supabase_project_ref, paused_at",
    )
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return Response.json(null);

  // For managed backends, surface the project's grace window (if any) so
  // the UI can show a "top up to keep your backend live" warning.
  let graceUntil: string | null = null;
  if (data.provider === "managed_petal") {
    const { data: projRow } = await supabaseAdmin
      .from("projects")
      .select("runtime_grace_until")
      .eq("id", parsed.data.projectId)
      .maybeSingle();
    graceUntil = projRow?.runtime_grace_until ?? null;
  }

  return Response.json({
    status: data.status,
    provider: data.provider,
    supabaseUrl: data.supabase_url,
    anonKey: data.anon_key,
    errorMessage: data.error_message,
    supabaseProjectRef: data.supabase_project_ref,
    pausedAt: data.paused_at,
    graceUntil,
  });
}

/**
 * POST /api/backend?action=enable-managed
 *
 * Cloud-balance enable: requires the user's Cloud top-up balance ≥ $10.
 * Inserts a `project_backends` row in `provisioning` state and kicks off the
 * upstream Supabase provision in the background. Idempotent — if a row
 * already exists, returns its current state.
 */
async function handleEnableManaged(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  // Already attached? Return current state.
  const { data: existing } = await supabaseAdmin
    .from("project_backends")
    .select("provider, status")
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (existing) {
    return new Response(
      JSON.stringify({
        error:
          existing.provider === "managed_petal"
            ? "A managed backend is already attached to this project."
            : "This project is already connected to a backend.",
        code: "already_connected",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  // Plan + balance check.
  // Rule:
  //  - Free plan: blocked. UI surfaces an upgrade prompt instead of top-up.
  //  - Paid plan: allowed as long as the runtime wallet has > $0 (free + topup).
  //    The first paid-plan upgrade auto-grants $5 so this is non-blocking
  //    for new paying users; only paid users who fully drained their wallet
  //    hit the balance_empty branch.
  const { data: wallet } = await supabaseAdmin
    .from("user_wallets")
    .select("plan_code, runtime_topup_balance_cents, runtime_free_balance_cents")
    .eq("user_id", userId)
    .maybeSingle();
  const planCode = String(wallet?.plan_code ?? "free");
  const topup = Number(wallet?.runtime_topup_balance_cents ?? 0);
  const free = Number(wallet?.runtime_free_balance_cents ?? 0);
  const totalBalance = topup + free;

  if (!PAID_PLAN_CODES.has(planCode)) {
    return new Response(
      JSON.stringify({
        error: "Backends are included with paid plans. Upgrade to add a backend.",
        code: "plan_upgrade_required",
        requiredPlan: "pro",
        currentPlan: planCode,
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }
  if (totalBalance <= 0) {
    return new Response(
      JSON.stringify({
        error:
          "Your Cloud balance is $0. Top up to enable Cloud on this project.",
        code: "balance_empty",
        currentCents: totalBalance,
        requiredCents: 1,
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  const { error: insertErr } = await supabaseAdmin.from("project_backends").insert({
    project_id: parsed.data.projectId,
    provider: "managed_petal",
    status: "provisioning",
    supabase_url: "",
    anon_key: "",
    provisioning_started_at: new Date().toISOString(),
  });
  if (insertErr) return new Response(insertErr.message, { status: 500 });

  // Clear any stale grace flag on this project.
  await supabaseAdmin
    .from("projects")
    .update({ runtime_grace_until: null, runtime_paused: false })
    .eq("id", parsed.data.projectId);

  // Fire-and-forget provisioning. UI polls via provision-status.
  provisionForProject(parsed.data.projectId).catch((e) =>
    console.error("[enable-managed] provision failed", e),
  );

  return Response.json({ ok: true, status: "provisioning" });
}

async function handleConnect(userId: string, body: unknown): Promise<Response> {
  const parsed = ConnectInput.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Invalid input", { status: 400 });
  }
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  const url = normalizeUrl(parsed.data.supabaseUrl);

  // Validate creds with a lightweight call.
  let healthOk = false;
  let errorMessage: string | null = null;
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: {
        apikey: parsed.data.anonKey,
        authorization: `Bearer ${parsed.data.anonKey}`,
      },
    });
    healthOk = res.ok;
    if (!healthOk) errorMessage = `Health check failed (${res.status})`;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "Health check failed";
  }
  if (!healthOk) {
    return new Response(
      errorMessage ?? "Could not reach the backend with those credentials.",
      { status: 400 },
    );
  }

  const { error: upsertErr } = await supabaseAdmin.from("project_backends").upsert(
    {
      project_id: parsed.data.projectId,
      provider: "byo_supabase",
      status: "ready",
      supabase_url: url,
      anon_key: parsed.data.anonKey,
      service_role_key: parsed.data.serviceRoleKey?.trim() || null,
      health_checked_at: new Date().toISOString(),
      error_message: null,
    },
    { onConflict: "project_id" },
  );
  if (upsertErr) return new Response(upsertErr.message, { status: 500 });

  return Response.json({
    status: "ready",
    provider: "byo_supabase",
    supabaseUrl: url,
    anonKey: parsed.data.anonKey,
    errorMessage: null,
  });
}

async function handleDisconnect(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;
  const { error } = await supabaseAdmin
    .from("project_backends")
    .delete()
    .eq("project_id", parsed.data.projectId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}

/* ---------------- Managed-backend actions ---------------- */

async function handleProvisionStatus(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;
  const status = await refreshStatus(parsed.data.projectId);
  return Response.json(status);
}

async function handleProvisionRetry(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  // Only allow retry from a failed state — otherwise we might double-create.
  const { data: row } = await supabaseAdmin
    .from("project_backends")
    .select("status, provider")
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (!row || row.provider !== "managed_petal") {
    return new Response("No managed backend on this project", { status: 404 });
  }
  if (row.status === "failed" || row.status === "paused") {
    if (row.status === "paused") {
      await restoreForProject(parsed.data.projectId);
    } else {
      await supabaseAdmin
        .from("project_backends")
        .update({ status: "provisioning", error_message: null })
        .eq("project_id", parsed.data.projectId);
    }
  }
  // Fire-and-forget; client polls for status.
  provisionForProject(parsed.data.projectId).catch((e) =>
    console.error("[backend retry] provision failed", e),
  );
  return Response.json({ ok: true });
}

async function handleManagedCredentials(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;
  const { data } = await supabaseAdmin
    .from("project_backends")
    .select(
      "provider, status, supabase_url, anon_key, service_role_key, supabase_project_ref",
    )
    .eq("project_id", parsed.data.projectId)
    .maybeSingle();
  if (!data || data.provider !== "managed_petal" || data.status !== "ready") {
    return new Response("Managed backend not ready", { status: 404 });
  }
  return Response.json({
    supabaseUrl: data.supabase_url,
    anonKey: data.anon_key,
    serviceRoleKey: data.service_role_key,
    supabaseProjectRef: data.supabase_project_ref,
  });
}

export const Route = createFileRoute("/api/backend")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;

        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        switch (action) {
          case "status":
            return handleStatus(auth, body);
          case "connect":
            return handleConnect(auth, body);
          case "disconnect":
            return handleDisconnect(auth, body);
          case "provision-status":
            return handleProvisionStatus(auth, body);
          case "provision-retry":
            return handleProvisionRetry(auth, body);
          case "managed-credentials":
            return handleManagedCredentials(auth, body);
          case "enable-managed":
            return handleEnableManaged(auth, body);
          default:
            return new Response("Unknown action", { status: 400 });
        }
      },
    },
  },
});
