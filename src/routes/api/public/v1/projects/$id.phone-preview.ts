/**
 * POST /api/public/v1/projects/:id/phone-preview
 * → { previewUrl, custardGoUrl, qrData, qrImageUrl, previewHost, certificate }
 *
 * Instant phone preview. Show `qrImageUrl` in Custard's "Preview on phone"
 * panel: Custard Go scans it and runs the app natively; a plain phone camera
 * opens the same address in the browser as an app-style preview.
 */
import { createFileRoute } from "@tanstack/react-router";
import { json, loadOwnedProject, preflight, previewUrlFor, verifyApiCaller } from "@/server/service-api.server";
import { previewHost } from "@/server/embed-preview";
import { custardGoLink, phonePreviewUrl, qrImageUrl } from "@/server/custard-go";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/v1/projects/$id/phone-preview")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        if (!(await previewUrlFor(params.id, null))) return json({ error: "no_ready_build" }, 409);

        const host = previewHost(params.id);
        let certificate = "unknown";
        try {
          const { ensureCustomHostname } = await import("@/server/cloudflare-saas.server");
          const cf = await ensureCustomHostname(host);
          certificate = cf.ssl?.status ?? "initializing";
        } catch (e) {
          console.error("[phone-preview] certificate request failed", host, e);
          return json({ error: "preview_address_unavailable" }, 502);
        }
        const previewUrl = phonePreviewUrl(params.id);
        return json({
          previewUrl,
          custardGoUrl: custardGoLink(params.id),
          qrData: previewUrl,
          qrImageUrl: qrImageUrl(previewUrl),
          previewHost: host,
          certificate,
        });
      },
    },
  },
});
