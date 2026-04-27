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
import { verifySignature } from "@/server/builder.server";

const CallbackSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    buildId: z.string().uuid(),
    projectId: z.string().uuid(),
    url: z.string().url().max(500),
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
    await supabaseAdmin
      .from("project_builds")
      .update({
        status: "ready",
        dist_path: payload.url,
        error_message: null,
        ready_at: new Date().toISOString(),
      })
      .eq("id", payload.buildId);

    // Always point the project at its newest build so the UI shows it.
    await supabaseAdmin
      .from("projects")
      .update({ latest_build_id: payload.buildId })
      .eq("id", payload.projectId);
  } else {
    // status === "failed"
    const message = payload.logs
      ? `${payload.errorMessage}\n\n--- logs ---\n${payload.logs}`
      : payload.errorMessage;
    await supabaseAdmin
      .from("project_builds")
      .update({
        status: "failed",
        error_message: message.slice(0, 8000),
        ready_at: new Date().toISOString(),
      })
      .eq("id", payload.buildId);
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
