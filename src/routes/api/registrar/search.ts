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
import { checkRateLimit, rateLimitResponse } from "@/server/rate-limit.server";

const Body = z.object({
  query: z.string().trim().min(1).max(64),
});

/**
 * Short-lived in-memory cache for availability lookups. CF Registrar pricing
 * doesn't change minute-to-minute and the same query is often retyped (e.g.
 * the search field autosubmits on each keystroke). Caching for 60s cuts
 * repeated API hits roughly 10× during interactive sessions while staying
 * fresh enough that the pre-purchase recheck still catches real changes.
 */
type CacheEntry = { at: number; body: string };
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();


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

        // 20 searches/min, 200/hr per user. Real users type a handful of
        // candidates; anything higher is a scraper burning CF API quota.
        const rl = checkRateLimit("registrar-search", auth, 20, 200);
        if (!rl.ok) return rateLimitResponse(rl);

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Invalid input";
          return new Response(msg, { status: 400 });
        }

        const cacheKey = parsed.query.trim().toLowerCase();
        const now = Date.now();
        const cached = cache.get(cacheKey);
        if (cached && now - cached.at < CACHE_TTL_MS) {
          return new Response(cached.body, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
          });
        }

        try {
          const results = await searchDomains(parsed.query);
          // Trim server-only fields and hide TLDs the API beta doesn't support.
          const visible = results
            .filter((r) => r.reason !== "extension_not_supported_via_api")
            .map((r) => ({
              hostname: r.hostname,
              available: r.available,
              priceCents: r.priceCents,
              tier: r.tier,
              reason: r.reason,
            }));
          const body = JSON.stringify(visible);
          cache.set(cacheKey, { at: now, body });
          // Opportunistic GC so the map can't grow without bound.
          if (cache.size > 1000) {
            for (const [k, v] of cache) {
              if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
            }
          }
          return new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Search failed";
          return new Response(msg, { status: 502 });
        }
      },

    },
  },
});
