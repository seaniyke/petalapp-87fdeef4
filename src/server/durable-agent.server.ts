/**
 * Durable agent jobs: generation keeps running when the browser goes away.
 *
 * On the live host a request's work dies when its caller disconnects. So the
 * browser is no longer the caller of the generation run: the Railway builder
 * is. The Worker ingress opens the turn row, hands a signed job to the builder
 * (`POST /agent/generate`), and the builder holds `/api/generate` open as an
 * internal caller until the run finishes. The browser only tails the turn's
 * recorded events, so refresh / tab close / network loss are pure reconnects.
 *
 * One code path: the builder runs exactly the same generation pipeline, it
 * just owns the connection. Switched on with USE_DURABLE_AGENT=1.
 */
import { createHmac } from "node:crypto";
import { trustedAppOrigin } from "@/server/public-origin";

/** Same header scheme as builder/src/signing.ts (kept local: this module is
 *  imported on the Stop path and must stay lightweight). */
function signRequest(secret: string, body: string): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { timestamp, signature };
}

/** Header the builder sets on the internal call: "attach to this turn row". */
export const DURABLE_TURN_HEADER = "x-petal-durable-turn";

/** Request headers the pipeline reads, forwarded to the internal call. */
export const FORWARDED_HEADERS = ["authorization", "x-petal-target", "x-kimble-inference-eval"] as const;

export type AgentJobPayload = {
  turnId: string;
  userId: string;
  /** The exact JSON body the browser sent (with `turnId` filled in). */
  body: Record<string, unknown>;
  /** Only the headers listed in FORWARDED_HEADERS. */
  headers: Record<string, string>;
  /** Origin the builder should call back into (this app). */
  appOrigin: string;
  /** Publishable backend settings for the in-process runtime. */
  publicConfig?: { supabaseUrl: string; supabasePublishableKey: string };
};

export function durableAgentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.USE_DURABLE_AGENT === "1" && Boolean(env.BUILDER_URL) && Boolean(env.BUILDER_SHARED_SECRET);
}

export function buildAgentJobPayload(
  request: Request,
  turnId: string,
  userId: string,
  body: Record<string, unknown>,
): AgentJobPayload {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers[name] = v;
  }
  // Publishable (non-secret) backend settings, so the in-process runtime on
  // the build server can verify sessions and read the user's own rows.
  const publicConfig =
    process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY
      ? { supabaseUrl: process.env.SUPABASE_URL, supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY }
      : undefined;
  return { turnId, userId, body: { ...body, turnId }, headers, appOrigin: trustedAppOrigin(request.url), publicConfig };
}

type FetchLike = typeof fetch;

async function signedPost(
  path: string,
  payload: unknown,
  fetcher: FetchLike,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const base = env.BUILDER_URL;
  const secret = env.BUILDER_SHARED_SECRET;
  if (!base || !secret) throw new Error("Builder is not configured");
  const raw = JSON.stringify(payload);
  const { timestamp, signature } = signRequest(secret, raw);
  return fetcher(new URL(path, base).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-petal-timestamp": timestamp,
      "x-petal-signature": signature,
    },
    body: raw,
  });
}

/** Hand the job to the builder. True only when the builder accepted it (202). */
export async function dispatchAgentJob(
  job: AgentJobPayload,
  fetcher: FetchLike = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  try {
    const res = await signedPost("/agent/generate", job, fetcher, env);
    if (res.status === 202) return { ok: true };
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, reason: text.slice(0, 300) || `builder returned ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error).message };
  }
}

/** Best-effort: stop the builder's run of this turn right away. The turn row
 *  (already `aborted`) remains the authority either way. */
export async function cancelAgentJob(
  turnId: string,
  fetcher: FetchLike = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!durableAgentEnabled(env)) return;
  try {
    await signedPost("/agent/cancel", { turnId }, fetcher, env);
  } catch {
    /* the pipeline's own boundary checks still stop it */
  }
}

/** The tiny response the browser gets: the turn id, then end of stream. The
 *  client already treats "turn id + end without done" as "reconnect to the
 *  turn's recorded events", so no new client path is needed. */
export function ingressAcceptedResponse(turnId: string): Response {
  const body = `data: ${JSON.stringify({ type: "turn_id", turnId })}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
