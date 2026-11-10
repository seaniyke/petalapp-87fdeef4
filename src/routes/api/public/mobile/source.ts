/**
 * GET /api/public/mobile/source?p=&e=&s=
 * The Codemagic build machine downloads one project's files here. Access
 * needs a Petal-signed, expiring link (see mobile-source-token.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifySourceLink } from "@/server/mobile-source-token";

const Query = z.object({
  p: z.string().uuid(),
  e: z.coerce.number().int(),
  s: z.string().regex(/^[0-9a-f]{64}$/),
});

export const Route = createFileRoute("/api/public/mobile/source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return new Response("Bad request", { status: 400 });
        const secret = process.env.MOBILE_CODEMAGIC_WEBHOOK_SECRET;
        if (!secret) return new Response("Not configured", { status: 503 });
        const ok = await verifySourceLink({
          projectId: parsed.data.p,
          exp: parsed.data.e,
          sig: parsed.data.s,
          secret,
        });
        if (!ok) return new Response("Forbidden", { status: 403 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("project_files")
          .select("path, content")
          .eq("project_id", parsed.data.p);
        if (error) return new Response("Read failed", { status: 500 });
        const files = (data ?? [])
          .filter((f) => f.path !== "codemagic.yaml")
          .map((f) => ({ path: f.path, content: f.content ?? "" }));
        return Response.json({ files }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
