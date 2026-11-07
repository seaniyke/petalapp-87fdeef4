/**
 * Machine-to-machine service API helpers.
 *
 * Petal is driven by Custard AI over HTTP. That caller proves itself
 * with one shared bearer key (`CUSTARD_API_KEY`) and acts through ONE
 * dedicated service account. Every build request is then forwarded to the
 * unchanged `/api/generate` pipeline with a real session for that account,
 * so ownership, credits, verification, checkpoints and billing all run
 * exactly as they did for signed-in users — no second orchestrator.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const SERVICE_ACCOUNT_EMAIL = "service@custardai.dev";

/** The shared key Custard AI uses for bearer auth and webhook signing. */
export function serviceKey(): string {
  return process.env.PETAL_API_KEY || process.env.CUSTARD_API_KEY || "";
}

/** The live address of the ready build for a turn (or the project's latest ready build). */
export async function previewUrlFor(projectId: string, turnId: string | null): Promise<string | null> {
  const sb = await admin();
  const pick = async (byTurn: boolean) => {
    let q = sb.from("project_builds").select("dist_path").eq("project_id", projectId).eq("status", "ready");
    if (byTurn && turnId) q = q.eq("turn_id", turnId);
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    const url = (data as { dist_path?: string | null } | null)?.dist_path ?? null;
    return url && /^https:\/\//.test(url) ? url : null;
  };
  return (turnId ? await pick(true) : null) ?? (await pick(false));
}

/** The three aliases Custard AI's canvas reads. */
export function previewFields(url: string | null) {
  return { previewUrl: url, preview_url: url, publishedUrl: url };
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Returns null when the caller holds the service key, else a 401/500. */
export function verifyServiceKey(request: Request): Response | null {
  const expected = serviceKey();
  if (!expected || expected.length < 16) {
    return json({ error: "service_key_not_configured" }, 500);
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  if (!timingSafeEqualStr(auth.slice(7), expected)) return json({ error: "unauthorized" }, 401);
  return null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

let cachedUserId: string | null = null;

/** The one account that owns every API-created project. Created on first use. */
export async function serviceUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const sb = await admin();
  const configured = process.env.CUSTARD_SERVICE_USER_ID;
  if (configured) {
    cachedUserId = configured;
    return cachedUserId;
  }
  const created = await sb.auth.admin.createUser({
    email: SERVICE_ACCOUNT_EMAIL,
    email_confirm: true,
    user_metadata: { service_account: true },
  });
  if (created.data.user) {
    cachedUserId = created.data.user.id;
    return cachedUserId;
  }
  // Already exists in auth but the profile lookup missed — find it.
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list?.users.find((u) => u.email === SERVICE_ACCOUNT_EMAIL);
  if (!found) throw new Error(`service account unavailable: ${created.error?.message ?? "unknown"}`);
  cachedUserId = found.id;
  return cachedUserId;
}

let cachedSession: { token: string; expiresAt: number } | null = null;

/** A real access token for the service account, minted server-side. */
export async function serviceAccessToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cachedSession && cachedSession.expiresAt - now > 120) return cachedSession.token;
  await serviceUserId();
  const sb = await admin();
  const link = await sb.auth.admin.generateLink({ type: "magiclink", email: SERVICE_ACCOUNT_EMAIL });
  const hash = link.data?.properties?.hashed_token;
  if (!hash) throw new Error(`could not mint service session: ${link.error?.message ?? "no token"}`);
  const anon = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: hash, type: "magiclink" });
  if (error || !data.session) throw new Error(`could not mint service session: ${error?.message ?? "no session"}`);
  cachedSession = { token: data.session.access_token, expiresAt: data.session.expires_at ?? now + 3000 };
  return cachedSession.token;
}

/** Project must exist and belong to the service account. */
export async function loadOwnedProject(projectId: string) {
  const sb = await admin();
  const owner = await serviceUserId();
  const { data } = await sb
    .from("projects")
    .select("id, title, revision, owner_id, created_at, updated_at")
    .eq("id", projectId)
    .maybeSingle();
  if (!data || data.owner_id !== owner) return null;
  return data;
}

export async function loadProjectFiles(projectId: string) {
  const sb = await admin();
  const { data } = await sb
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId)
    .order("path");
  return data ?? [];
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Webhook targets must be public https URLs. */
export function isAllowedWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

/** Signed POST: header `X-Petal-Signature: sha256=<hex HMAC of body with CUSTARD_API_KEY>`. */
export async function deliverWebhook(url: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  const sig = await hmacHex(serviceKey(), body);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Petal-Signature": `sha256=${sig}`, "X-Petal-Event": String((payload as { event?: string })?.event ?? "") },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      if (res.status < 500 && res.status !== 429) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  console.warn("[service-api] webhook delivery failed", new URL(url).host);
}

/** A build as Custard AI sees it. `deploymentUrl` is set only once live. */
export type PublicBuild = {
  buildId: string;
  status: "pending" | "building" | "ready" | "failed";
  revision: number | null;
  turnId: string | null;
  deploymentUrl: string | null;
  progress: string | null;
  error: string | null;
  createdAt: string;
  readyAt: string | null;
};

type BuildRow = {
  id: string;
  status: string;
  project_revision: number | null;
  turn_id: string | null;
  dist_path: string | null;
  deployed: boolean | null;
  progress_label: string | null;
  error_message: string | null;
  created_at: string;
  ready_at: string | null;
};

const BUILD_COLUMNS =
  "id,status,project_revision,turn_id,dist_path,deployed,progress_label,error_message,created_at,ready_at";

export function toPublicBuild(row: BuildRow): PublicBuild {
  const ready = row.status === "ready";
  const url = ready && row.dist_path && /^https:\/\//.test(row.dist_path) ? row.dist_path : null;
  return {
    buildId: row.id,
    status: (["pending", "building", "ready", "failed"].includes(row.status) ? row.status : "pending") as PublicBuild["status"],
    revision: row.project_revision == null ? null : Number(row.project_revision),
    turnId: row.turn_id,
    deploymentUrl: url,
    progress: row.progress_label,
    error: row.status === "failed" ? row.error_message : null,
    createdAt: row.created_at,
    readyAt: row.ready_at,
  };
}

export async function listProjectBuilds(projectId: string, limit = 10): Promise<PublicBuild[]> {
  const sb = await admin();
  const { data } = await sb
    .from("project_builds")
    .select(BUILD_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as BuildRow[]).map(toPublicBuild);
}

export async function getProjectBuild(projectId: string, buildId: string): Promise<PublicBuild | null> {
  const sb = await admin();
  const { data } = await sb
    .from("project_builds")
    .select(BUILD_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", buildId)
    .maybeSingle();
  return data ? toPublicBuild(data as unknown as BuildRow) : null;
}

/**
 * Start (or reuse) the compile + test + deploy run for a project through the
 * one build entry point, `/api/builds/trigger`, as the service account. The
 * trigger is idempotent per code revision, so calling it after the build
 * server already started the same revision returns that build.
 */
export async function triggerProjectBuild(
  selfOrigin: string,
  projectId: string,
  opts: { turnId?: string | null; revision?: number | null } = {},
): Promise<{ ok: true; buildId: string | null; status: string; superseded?: boolean; reused?: boolean } | { ok: false; status: number; error: string }> {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return { ok: false, status: 500, error: "builder_not_configured" };
  const userId = await serviceUserId();
  const res = await fetch(new URL("/api/builds/trigger", selfOrigin), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-petal-internal-secret": secret, "x-petal-internal-user": userId },
    body: JSON.stringify({
      projectId,
      ...(opts.turnId ? { turnId: opts.turnId } : {}),
      ...(opts.revision != null ? { revision: Number(opts.revision) } : {}),
    }),
  }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as unknown as Response);
  const out = (await res.json().catch(() => null)) as
    | { buildId?: string | null; status?: string; error?: string; superseded?: boolean; reused?: boolean }
    | null;
  if (!res.ok) return { ok: false, status: res.status, error: out?.error ?? `trigger_failed_${res.status}` };
  if (out?.status === "failed") return { ok: false, status: 502, error: out.error ?? "build_service_unreachable" };
  return { ok: true, buildId: out?.buildId ?? null, status: out?.status ?? "pending", superseded: out?.superseded, reused: out?.reused };
}

/** Poll one build until it is ready/failed or `maxMs` passes. Yields each change. */
export async function* followBuild(
  projectId: string,
  buildId: string,
  maxMs = 20 * 60_000,
): AsyncGenerator<PublicBuild> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < maxMs) {
    const b = await getProjectBuild(projectId, buildId);
    if (!b) return;
    const key = `${b.status}|${b.progress ?? ""}`;
    if (key !== last) {
      last = key;
      yield b;
    }
    if (b.status === "ready" || b.status === "failed") return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const TERMINAL = new Set(["succeeded", "failed", "aborted", "awaiting_credits"]);

/**
 * Tail a turn's durable events (`turn_events`) as SSE lines, starting after
 * `afterSeq`, until the turn is terminal or `maxMs` passes. Used when the
 * build runs on the build server and for reconnects.
 */
export async function* tailTurnEvents(
  turnId: string,
  afterSeq = 0,
  maxMs = 25 * 60_000,
): AsyncGenerator<{ kind: string; payload: Record<string, unknown>; seq: number }> {
  const sb = await admin();
  const started = Date.now();
  let seq = afterSeq;
  while (Date.now() - started < maxMs) {
    const { data: events } = await sb
      .from("turn_events")
      .select("seq,kind,payload")
      .eq("turn_id", turnId)
      .gt("seq", seq)
      .order("seq", { ascending: true })
      .limit(500);
    for (const e of events ?? []) {
      seq = e.seq;
      const payload = (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
      yield { kind: e.kind, payload, seq: e.seq };
      if (e.kind === "done") return;
    }
    if (!events?.length) {
      const { data: turn } = await sb.from("turns").select("status").eq("id", turnId).maybeSingle();
      if (!turn || TERMINAL.has(turn.status)) {
        yield { kind: "done", payload: { status: turn?.status ?? "unknown" }, seq };
        return;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  yield { kind: "timeout", payload: { message: "stream window ended; reconnect with after=<seq>" }, seq };
}
