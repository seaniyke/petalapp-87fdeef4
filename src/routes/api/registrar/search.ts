/**
 * POST /api/registrar/search — domain availability + pricing.
 *
 * Body: { query: string }
 * Returns: DomainSearchResult[] (hostname, available, priceCents)
 *
 * Auth required (any signed-in user) so we don't expose Cloudflare API quota
 * to the world.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { searchDomains } from "@/server/cloudflare-registrar.server";

const Body = z.object({
  query: z.string().trim().min(1).max(64),
});

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(auth.slice(7));
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

export const Route = createFileRoute("/api/registrar/search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Invalid input";
          return new Response(msg, { status: 400 });
        }

        try {
          const results = await searchDomains(parsed.query);
          return Response.json(results);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Search failed";
          return new Response(msg, { status: 502 });
        }
      },
    },
  },
});
