/**
 * POST /api/public/v1/projects/:id/embed-preview  { allowedOrigin }
 * → { embedUrl, expiresAt, allowedOrigin, previewHost }
 *
 * Returns a one-hour address that shows the project's latest ready build and
 * may be framed ONLY by `allowedOrigin`. Visitors need no sign-in.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { callerOf, json, loadOwnedProject, preflight, previewUrlFor, verifyApiCaller } from "@/server/service-api.server";
import { EMBED_TTL_MS, embedUrl, newEmbedToken, normalizeEmbedOrigin, previewHost } from "@/server/embed-preview";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({ allowedOrigin: z.string().max(300) });

export const Route = createFileRoute("/api/public/v1/projects/$id/embed-preview")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const origin = normalizeEmbedOrigin(parsed.data.allowedOrigin);
        if (!origin) return json({ error: "invalid_origin", hint: "Use https://host[:port] (http only for localhost)." }, 400);
        if (!(await previewUrlFor(params.id, null))) return json({ error: "no_ready_build" }, 409);

        // One certificate per project, requested on first use (Cloudflare issues it in ~1 minute).
        const host = previewHost(params.id);
        let certificate: string = "unknown";
        try {
          const { ensureCustomHostname } = await import("@/server/cloudflare-saas.server");
          const cf = await ensureCustomHostname(host);
          certificate = cf.ssl?.status ?? "initializing";
        } catch (e) {
          console.error("[embed-preview] certificate request failed", host, e);
          return json({ error: "preview_address_unavailable" }, 502);
        }

        const caller = callerOf(request);
        const token = newEmbedToken();
        const expiresAt = new Date(Date.now() + EMBED_TTL_MS).toISOString();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("project_embeds").insert({
          id: token,
          project_id: params.id,
          allowed_origin: origin,
          created_by_key: caller?.kind === "developer" ? caller.keyId : null,
          expires_at: expiresAt,
        });
        if (error) return json({ error: "embed_failed" }, 500);
        return json(
          {
            embedUrl: embedUrl(params.id, token),
            expiresAt,
            allowedOrigin: origin,
            previewHost: host,
            certificateReady: certificate === "active",
          },
          201,
        );
      },
    },
  },
});
