/**
 * Reconcile builds the build service ran but never reported back.
 *
 * The builder is the only component that knows a build finished, and it tells
 * us through two outbound calls: heartbeats (liveness) and the final callback
 * (result). When those outbound calls cannot reach us — a stale builder image,
 * a misconfigured callback URL, an outbound blip — the app is left with a
 * build that looks abandoned even though the app was compiled and published
 * successfully. The stalled-build reaper then fails it with "The build service
 * stopped responding", and the user loses a build that actually worked.
 *
 * This module closes that hole from our side by *pulling* what the builder
 * would have pushed:
 *
 *  1. Ask the builder which builds it is working on right now (`/healthz`).
 *     Anything it still owns gets its progress timestamp refreshed, so a
 *     healthy build is never reaped for a missing heartbeat.
 *  2. For a build the builder was previously seen working on but no longer
 *     owns, probe the deterministic Cloudflare Pages hostname for that
 *     project. If it serves a real app, deliver the callback the builder
 *     failed to deliver — through the real callback handler, so deploy
 *     probing, QA scoring, project pointer, thumbnails and credit accounting
 *     all behave exactly as on the happy path.
 *
 * Anything we cannot prove is left alone for the retry path to handle.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signRequest } from "@/server/builder.server";
import { handleBuildCallback } from "@/routes/api/public/builds/callback";

export type ReconcileOutcome =
  | "still_running"
  | "recovered"
  | "unresolved"
  | "error";

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  url?: string;
  label?: string;
  error?: string;
}

/** Mirrors `projectNameFor()` in builder/src/build.ts — must stay identical. */
export function pagesProjectName(projectId: string): string {
  return `petal-${projectId.replace(/-/g, "").slice(0, 12).toLowerCase()}`;
}

export function pagesUrlFor(projectId: string): string {
  return `https://${pagesProjectName(projectId)}.pages.dev`;
}

interface ActiveBuild {
  buildId: string;
  label?: string;
}

/**
 * Builds the builder is working on right now. Returns null when the builder
 * cannot be reached at all — the caller must not treat "unknown" as "finished".
 */
export async function fetchBuilderActive(): Promise<Map<string, ActiveBuild> | null> {
  const builderUrl = process.env.BUILDER_URL;
  if (!builderUrl) return null;
  try {
    const res = await fetch(`${builderUrl.replace(/\/+$/, "")}/healthz`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { active?: Array<{ buildId?: string; label?: string }> };
    const map = new Map<string, ActiveBuild>();
    for (const entry of body.active ?? []) {
      if (entry?.buildId) map.set(entry.buildId, { buildId: entry.buildId, label: entry.label });
    }
    return map;
  } catch {
    return null;
  }
}

/** Does this hostname serve a real app right now? */
async function deploymentIsLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return false;
    const html = await res.text();
    return html.length > 200 && /<div[^>]+id=["']root["']|<script/i.test(html);
  } catch {
    return false;
  }
}

/**
 * Deliver the callback the builder never sent, through the real handler so
 * every downstream step (deploy probe, QA, project pointer, thumbnail,
 * credits) runs exactly as it does on the happy path.
 */
async function deliverSyntheticReady(args: {
  buildId: string;
  projectId: string;
  url: string;
}): Promise<boolean> {
  const secret = process.env.BUILDER_SHARED_SECRET;
  if (!secret) return false;
  const body = JSON.stringify({
    status: "ready",
    buildId: args.buildId,
    projectId: args.projectId,
    url: args.url,
  });
  const { timestamp, signature } = signRequest(secret, body);
  const request = new Request("https://internal/api/public/builds/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-petal-timestamp": timestamp,
      "x-petal-signature": signature,
    },
    body,
  });
  const res = await handleBuildCallback(request);
  return res.ok;
}

/**
 * Reconcile one quiet build against what the builder and the hosting edge say.
 * Never marks anything failed: an inconclusive check returns "unresolved" and
 * the retry path decides.
 */
export async function reconcileStalledBuild(
  build: { id: string; project_id: string; progress_label?: string | null },
  active: Map<string, ActiveBuild> | null,
): Promise<ReconcileResult> {
  try {
    // Builder cannot be reached — say nothing, let the retry path act.
    if (!active) return { outcome: "unresolved" };

    const running = active.get(build.id);
    if (running) {
      await supabaseAdmin
        .from("project_builds")
        .update({
          last_progress_at: new Date().toISOString(),
          ...(running.label ? { progress_label: running.label } : {}),
        })
        .eq("id", build.id)
        .in("status", ["pending", "building"]);
      return { outcome: "still_running", label: running.label };
    }

    // Only a build we previously watched the builder run can be resolved from
    // a live hostname: without that evidence, a hostname left over from an
    // earlier deployment would look like this build's success.
    if (!build.progress_label) return { outcome: "unresolved" };

    const url = pagesUrlFor(build.project_id);
    if (!(await deploymentIsLive(url))) return { outcome: "unresolved" };

    const delivered = await deliverSyntheticReady({
      buildId: build.id,
      projectId: build.project_id,
      url,
    });
    if (!delivered) return { outcome: "unresolved", url };
    console.log(`[build-reconcile] recovered build=${build.id} url=${url}`);
    return { outcome: "recovered", url };
  } catch (e) {
    return { outcome: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Convenience wrapper for the browser-driven watchdog: load the build, confirm
 * ownership, then reconcile it against the build service.
 */
export async function reconcileBuildById(
  buildId: string,
  opts: { requireOwnerId?: string } = {},
): Promise<ReconcileResult> {
  const { data: build } = await supabaseAdmin
    .from("project_builds")
    .select("id, project_id, status, progress_label")
    .eq("id", buildId)
    .maybeSingle();
  if (!build || !["pending", "building"].includes(build.status ?? "")) {
    return { outcome: "unresolved" };
  }
  if (opts.requireOwnerId) {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("owner_id")
      .eq("id", build.project_id)
      .maybeSingle();
    if (!project || project.owner_id !== opts.requireOwnerId) return { outcome: "unresolved" };
  }
  return reconcileStalledBuild(build, await fetchBuilderActive());
}
