/**
 * /api/public/track — public page-view ingest.
 *
 * Called by a tiny beacon injected by the subdomain Worker into every HTML
 * response served from a published Petal site. No authentication required;
 * the database `record_page_view` function silently no-ops on unknown
 * project ids so anonymous traffic can't pollute the table.
 *
 * Body (JSON or sendBeacon):
 *   { project_id, path, referrer, visitor_hash }
 *
 * Visitor hash is computed in the browser from `navigator.userAgent` plus
 * the date — it identifies a unique-per-day visitor without storing IPs or
 * setting cookies.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Body = z.object({
  project_id: z.string().uuid(),
  path: z.string().max(2048).optional(),
  referrer: z.string().max(2048).optional(),
  visitor_hash: z.string().max(128).optional(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export const Route = createFileRoute("/api/public/track")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: unknown = null;
        try {
          payload = await request.json();
        } catch {
          return new Response("Bad request", { status: 400, headers: CORS });
        }
        const parsed = Body.safeParse(payload);
        if (!parsed.success) {
          return new Response("Bad request", { status: 400, headers: CORS });
        }
        const { project_id, path, referrer, visitor_hash } = parsed.data;

        const country =
          request.headers.get("cf-ipcountry") ??
          request.headers.get("x-vercel-ip-country") ??
          null;
        const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;

        // Cheap bot filter — most well-behaved bots include "bot" in the UA.
        if (userAgent && /bot|crawler|spider|preview|curl|wget|axios/i.test(userAgent)) {
          return new Response(null, { status: 204, headers: CORS });
        }

        const { error } = await supabaseAdmin.rpc("record_page_view", {
          _project_id: project_id,
          _path: path ?? "/",
          _referrer: referrer ?? "",
          _country: country ?? "",
          _user_agent: userAgent ?? "",
          _visitor_hash: visitor_hash ?? "",
        });
        if (error) {
          // Don't leak details to anonymous callers.
          return new Response(null, { status: 204, headers: CORS });
        }
        return new Response(null, { status: 204, headers: CORS });
      },
    },
  },
});
