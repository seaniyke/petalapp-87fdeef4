/**
 * Share-card image for a published site: the saved build screenshot, cropped
 * to 1200×630. Called by the subdomain worker for GET /og-image.png.
 * Public on purpose (social crawlers fetch it); only serves public sites and
 * returns nothing but the screenshot bytes. Captures a screenshot first when
 * none exists yet.
 */
import { createFileRoute } from "@tanstack/react-router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Storage public URL → 1200×630 cover-cropped render URL. */
export function ogRenderUrl(publicUrl: string): string | null {
  if (!publicUrl.includes("/storage/v1/object/public/")) return null;
  const base = publicUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  return `${base}${base.includes("?") ? "&" : "?"}width=1200&height=630&resize=cover`;
}

export const Route = createFileRoute("/api/public/og-image/$projectId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!UUID.test(params.projectId)) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: project } = await supabaseAdmin
          .from("projects")
          .select("id, published_visibility, published_build_id")
          .eq("id", params.projectId)
          .maybeSingle();
        if (!project || project.published_visibility !== "public") return new Response("Not found", { status: 404 });

        // Always the screenshot of the build that is live now.
        const { ensureSavedThumbnail } = await import("@/server/project-thumbnail.server");
        const thumb = await ensureSavedThumbnail(project.id, project.published_build_id, { wait: true }).catch(() => null);
        if (!thumb?.url) return new Response("No screenshot yet", { status: 404, headers: { "Cache-Control": "no-store" } });

        const candidates = [ogRenderUrl(thumb.url), thumb.url].filter(Boolean) as string[];
        for (const src of candidates) {
          const res = await fetch(src).catch(() => null);
          if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) continue;
          return new Response(res.body, {
            headers: {
              "Content-Type": res.headers.get("content-type") ?? "image/png",
              "Cache-Control": "public, max-age=3600",
            },
          });
        }
        return new Response("Image unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
