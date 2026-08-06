/**
 * Webhook called by the Railway builder when a build finishes (or fails).
 *
 * The builder signs every callback with HMAC-SHA256 using BUILDER_SHARED_SECRET.
 * We verify the signature before doing anything with the body — see
 * `src/server/builder.server.ts` for the matching `signRequest()` helper used
 * in the outgoing direction.
 *
 * URL: /api/public/builds/callback (under /api/public/* so platform auth
 *      doesn't shield it from Railway).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeVerificationDefects } from "@/lib/verification-report";
import { verifySignature } from "@/server/builder.server";
import { probeDeployedUrl } from "@/server/deploy-verify.server";

/**
 * Browser-verification report. Kept loose on purpose: the builder owns the
 * shape, and a schema mismatch must never reject an otherwise-good callback.
 */
const VerificationSchema = z
  .object({
    ok: z.boolean(),
    baseUrl: z.string().max(500).optional(),
    durationMs: z.number().optional(),
    routes: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
    auth: z.record(z.string(), z.unknown()).optional(),
    flows: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
    defects: z.array(z.string().max(1000)).max(60).optional(),
    skipped: z.string().max(500).optional(),
  })
  .passthrough();

const CallbackSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    buildId: z.string().uuid(),
    projectId: z.string().uuid(),
    url: z.string().url().max(500),
    verification: VerificationSchema.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    buildId: z.string().uuid(),
    projectId: z.string().uuid(),
    errorMessage: z.string().min(1).max(2000),
    logs: z.string().max(8000).optional(),
  }),
]);

export async function handleBuildCallback(request: Request): Promise<Response> {
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!sharedSecret) {
    console.error("BUILDER_SHARED_SECRET missing");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Read body as text so we can verify the signature byte-for-byte.
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-petal-timestamp");
  const signature = request.headers.get("x-petal-signature");

  if (!verifySignature(sharedSecret, rawBody, timestamp, signature)) {
    console.warn("Builder callback rejected: invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const result = CallbackSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("Builder callback rejected: invalid body", result.error.flatten());
    return new Response("Invalid body", { status: 400 });
  }
  const payload = result.data;

  // Make sure the build row actually belongs to the claimed project.
  // Defends against a compromised builder or a bug that scrambles ids.
  const { data: existing } = await supabaseAdmin
    .from("project_builds")
    .select("id, project_id")
    .eq("id", payload.buildId)
    .maybeSingle();
  if (!existing) {
    console.warn("Builder callback for unknown build", payload.buildId);
    // Acknowledge so Railway doesn't retry forever.
    return new Response("ok", { status: 200 });
  }
  if (existing.project_id !== payload.projectId) {
    console.warn("Builder callback project mismatch", payload.buildId);
    return new Response("Project mismatch", { status: 400 });
  }

  if (payload.status === "ready") {
    // AI Generation Bible §8 — the builder's own "ready" is a claim, not
    // evidence. Fetch the URL we are about to advertise as live and confirm
    // it serves a real app. A failed probe becomes an honest build failure;
    // crucially we do NOT repoint `latest_build_id`, so the last known-good
    // preview survives.
    const probe = await probeDeployedUrl(payload.url);
    if (!probe.ok) {
      console.warn(
        `[builds/callback] deploy verification failed for ${payload.buildId}: ${probe.reason} (${probe.status ?? "no status"})`,
      );
      await supabaseAdmin
        .from("project_builds")
        .update({
          status: "failed",
          dist_path: payload.url,
          error_message: `${probe.message} Petal kept your previous preview live instead of shipping a broken one.`,
        })
        .eq("id", payload.buildId);
      return new Response("ok", { status: 200 });
    }

    const verification = payload.verification
      ? {
          ...payload.verification,
          defects: sanitizeVerificationDefects(payload.verification.defects),
          ok:
            payload.verification.ok ||
            sanitizeVerificationDefects(payload.verification.defects).length === 0,
        }
      : null;
    const { error: buildUpdateError } = await supabaseAdmin
      .from("project_builds")
      .update({
        status: "ready",
        dist_path: payload.url,
        error_message: null,
        ready_at: new Date().toISOString(),
        // Null when the build predates verification or the plan was empty.
        verification: verification as never,
      })
      .eq("id", payload.buildId);
    if (buildUpdateError) {
      console.error("Builder callback could not mark build ready", buildUpdateError.message);
      return new Response("Could not save build status", { status: 503 });
    }

    // Always point the project at its newest build so the UI shows it.
    const { error: projectUpdateError } = await supabaseAdmin
      .from("projects")
      .update({ latest_build_id: payload.buildId })
      .eq("id", payload.projectId);
    if (projectUpdateError) {
      console.error("Builder callback could not update project build", projectUpdateError.message);
      return new Response("Could not save project status", { status: 503 });
    }
  } else {
    // status === "failed"
    const message = payload.logs
      ? `${payload.errorMessage}\n\n--- logs ---\n${payload.logs}`
      : payload.errorMessage;
    const { error: buildUpdateError } = await supabaseAdmin
      .from("project_builds")
      .update({
        status: "failed",
        error_message: message.slice(0, 8000),
        ready_at: new Date().toISOString(),
      })
      .eq("id", payload.buildId);
    if (buildUpdateError) {
      console.error("Builder callback could not mark build failed", buildUpdateError.message);
      return new Response("Could not save build status", { status: 503 });
    }
  }

  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export const Route = createFileRoute("/api/public/builds/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => handleBuildCallback(request),
    },
  },
});
