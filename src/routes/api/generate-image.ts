/**
 * Public image generation endpoint.
 *
 * Two callers, two policies:
 *   1. The Petal builder (authenticated owner, when the AI is making an app).
 *      → Sends `Authorization: Bearer <supabase-jwt>`. We validate the token,
 *        charge ONE credit pre-flight via `spendCredit`, and refund on any
 *        downstream failure so the user isn't charged for a broken image.
 *   2. END-USER apps that the AI generated (unauthenticated random visitor).
 *      → No bearer token. We keep the existing per-IP soft cap (in-memory
 *        token bucket) so a beta app can still call this without auth, but
 *        a single visitor can't burn unlimited spend.
 *
 * Returns `{ url: string }` pointing at a public petal-images bucket object.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { generatePetalImage } from "@/server/image-generation.server";
import { spendCredit, refundCredit } from "@/server/credits.server";

type Body = {
  prompt?: string;
  aspectRatio?: "1:1" | "16:9" | "4:3" | "3:4" | "9:16";
  projectId?: string | null;
};

/** Per-IP token bucket for ANONYMOUS callers only. Resets every minute. */
const RATE_BUCKET = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_PER_MIN = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const slot = RATE_BUCKET.get(ip);
  if (!slot || slot.resetAt < now) {
    RATE_BUCKET.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  slot.count += 1;
  return slot.count > RATE_LIMIT_PER_MIN;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Resolve the bearer token to a userId, or return:
 *   - null  → no Authorization header (anonymous caller, fall through to IP cap)
 *   - Response → header was present but invalid (401)
 *   - string → authenticated userId (charge credits)
 */
async function resolveBearer(request: Request): Promise<string | null | Response> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return data.claims.sub;
}

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Decide which policy applies based on the Authorization header.
        const authResult = await resolveBearer(request);
        if (authResult instanceof Response) return authResult;
        const userId: string | null = authResult; // null = anonymous

        // 2. Anonymous callers: enforce the per-IP soft cap. Authenticated
        //    callers skip this — they pay credits instead.
        if (!userId) {
          const ip = clientIp(request);
          if (rateLimited(ip)) {
            return new Response(
              JSON.stringify({
                error: "Too many image requests. Try again in a minute.",
              }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }
        }

        // 3. Parse + validate input.
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const prompt = body.prompt?.trim();
        if (!prompt || prompt.length < 3) {
          return new Response(
            JSON.stringify({ error: "prompt must be at least 3 characters" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (prompt.length > 500) {
          return new Response(
            JSON.stringify({ error: "prompt is too long (max 500 chars)" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // 4. Authenticated builder calls: charge ONE credit pre-flight.
        //    On failure later we refund. Anonymous calls skip this entirely.
        let imageLedgerId: string | null = null;
        if (userId) {
          const charge = await spendCredit({
            userId,
            amount: 1.0,
            reason: "ai_image",
            projectId: body.projectId ?? null,
            metadata: { route: "/api/generate-image" },
          });
          if (!charge.ok) {
            if (charge.reason === "insufficient_credits") {
              return new Response(
                JSON.stringify({
                  error:
                    "You're out of credits. Add credits in Settings → Plans & Credits to keep generating.",
                }),
                { status: 402, headers: { "Content-Type": "application/json" } },
              );
            }
            return new Response(
              JSON.stringify({ error: "Could not verify credit balance. Try again." }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          imageLedgerId = charge.ledgerId;
        }

        // Helper: refund the credit we charged in step 4 (only meaningful
        // for authenticated callers). No-op for anonymous traffic.
        const refund = async (note: string) => {
          if (!userId || !imageLedgerId) return;
          await refundCredit({
            userId,
            ledgerId: imageLedgerId,
            reason: "ai_image_refund",
            metadata: { route: "/api/generate-image", failure: note },
          });
        };

        // 5. Invoke the upstream image generator. Refund on any failure.
        try {
          const result = await generatePetalImage({
            prompt,
            aspectRatio: body.aspectRatio,
          });
          return new Response(
            JSON.stringify({ url: result.url, cached: result.cached }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                // Surface the URL to any cross-origin preview that needs it.
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Image generation failed";
          console.error("/api/generate-image error", e);
          // Map gateway errors to friendly statuses.
          const status = /402/.test(message) ? 402 : /429/.test(message) ? 429 : 500;
          // Refund on any upstream failure so the user isn't charged for a
          // broken image. Best-effort — we log if the refund itself fails.
          await refund(`upstream_${status}`);
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type, authorization",
          },
        });
      },
    },
  },
});
