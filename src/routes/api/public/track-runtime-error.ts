/**
 * Public ingest for runtime crashes from deployed Petal apps.
 *
 * The preview-guard script injected into every published build POSTs
 * here when window.onerror fires, an unhandled promise rejection
 * surfaces, or the app rendered blank. This is how Petal sees crashes
 * in CDN-hosted previews where postMessage to a parent iframe is
 * unavailable (e.g. user opening their app directly on the
 * `*.lovable.app` URL or a custom domain).
 *
 * No auth required — this is intentionally a public endpoint. Inputs
 * are tightly bounded with Zod, the project_id must reference an
 * existing project, and the table is owner-readable only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const Schema = z.object({
  projectId: z.string().uuid(),
  buildId: z.string().uuid().nullable().optional(),
  kind: z.enum(["error", "unhandledrejection", "blank"]),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).nullable().optional(),
  source: z.string().max(1000).nullable().optional(),
  lineno: z.number().int().min(0).max(10_000_000).nullable().optional(),
  colno: z.number().int().min(0).max(10_000_000).nullable().optional(),
  pageUrl: z.string().max(1000).nullable().optional(),
});

export const Route = createFileRoute("/api/public/track-runtime-error")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "Invalid body" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
        }
        const p = parsed.data;
        const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

        // Fire and forget; failure here must not break the user's app.
        try {
          await supabaseAdmin.from("petal_runtime_errors").insert({
            project_id: p.projectId,
            build_id: p.buildId ?? null,
            kind: p.kind,
            message: p.message,
            stack: p.stack ?? null,
            source: p.source ?? null,
            lineno: p.lineno ?? null,
            colno: p.colno ?? null,
            user_agent: userAgent,
            page_url: p.pageUrl ?? null,
          });
        } catch (e) {
          console.warn(
            "[track-runtime-error] insert failed:",
            e instanceof Error ? e.message : String(e),
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      },
    },
  },
});
