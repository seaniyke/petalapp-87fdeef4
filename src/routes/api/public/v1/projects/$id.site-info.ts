/**
 * Partner API — the live site's title, description and share image.
 *   PUT /api/public/v1/projects/:id/site-info
 *       { title: string, description: string | null, ogImageUrl: string | null,
 *         iconUrl?: string | null } → { ok: true, iconUrl? }
 * ogImageUrl and iconUrl must be https and on the project's own hostname (its
 * subdomain or an active connected domain). iconUrl may also be on custardai.dev:
 * Petal copies that logo into its own storage and returns the saved address
 * as `iconUrl` (PNG/JPEG/WebP/GIF/SVG/ICO, ≤1 MB). Omitting iconUrl keeps the saved
 * one; null clears it (the site then shows a letter icon made from its name).
 * Service key + project ownership required.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, loadOwnedProject, preflight, verifyApiCaller } from "@/server/service-api.server";
import { isOwnSiteImageUrl, isPartnerAssetUrl } from "@/lib/site-image-url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).nullable(),
  ogImageUrl: z.string().trim().max(2048).nullable(),
  iconUrl: z.string().trim().max(2048).nullable().optional(),
});

export const Route = createFileRoute("/api/public/v1/projects/$id/site-info")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      PUT: async ({ request, params }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        if (!UUID.test(params.id)) return json({ error: "bad_project_id" }, 400);
        if (!(await loadOwnedProject(params.id, request))) return json({ error: "not_found" }, 404);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const { title, description, ogImageUrl, iconUrl } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let savedIcon = iconUrl;
        if (ogImageUrl || iconUrl) {
          const [{ data: proj }, { data: domains }] = await Promise.all([
            supabaseAdmin.from("projects").select("subdomain").eq("id", params.id).maybeSingle(),
            supabaseAdmin.from("project_domains").select("hostname").eq("project_id", params.id).eq("status", "active"),
          ]);
          const hosts = (domains ?? []).map((d) => String(d.hostname));
          if (ogImageUrl && !isOwnSiteImageUrl(ogImageUrl, proj?.subdomain ?? null, hosts)) {
            return json({ error: "og_image_not_allowed", message: "ogImageUrl must be https on this site's own address." }, 400);
          }
          if (iconUrl && !isOwnSiteImageUrl(iconUrl, proj?.subdomain ?? null, hosts)) {
            if (!isPartnerAssetUrl(iconUrl)) {
              return json(
                { error: "icon_not_allowed", message: "iconUrl must be https on this site's own address or on custardai.dev." },
                400,
              );
            }
            // Partner-hosted logo: keep a copy so the tab icon never depends on it.
            const { copyPartnerIcon } = await import("@/server/partner-icon.server");
            const copied = await copyPartnerIcon(params.id, iconUrl);
            if (!copied.ok) return json({ error: copied.error, message: copied.message }, 400);
            savedIcon = copied.url;
          }
        }
        const { error } = await supabaseAdmin
          .from("projects")
          .update({
            site_title: title,
            site_description: description || null,
            site_og_image_url: ogImageUrl || null,
            ...(iconUrl !== undefined ? { site_icon_url: savedIcon || null } : {}),
          })
          .eq("id", params.id);
        if (error) return json({ error: "save_failed" }, 500);
        return json({ ok: true, ...(iconUrl !== undefined ? { iconUrl: savedIcon || null } : {}) });
      },
    },
  },
});
