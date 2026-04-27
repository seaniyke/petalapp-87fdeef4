/**
 * Public image generation endpoint.
 *
 * Two callers:
 *   1. The Petal builder (authenticated owner, when the AI is making an app).
 *      → Reuses the user's bearer token, single-use call.
 *   2. END-USER apps that the AI generated (unauthenticated random visitor).
 *      → Rate-limited by IP via a tiny in-memory bucket. Good enough for
 *        a beta — swap for a Redis or Postgres bucket once we have abuse.
 *
 * Returns `{ url: string }` pointing at a public petal-images bucket object.
 */
import { createFileRoute } from "@tanstack/react-router";
import { generatePetalImage } from "@/server/image-generation.server";

type Body = {
  prompt?: string;
  aspectRatio?: "1:1" | "16:9" | "4:3" | "3:4" | "9:16";
};

/** Per-IP token bucket. Resets every minute. */
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

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (rateLimited(ip)) {
          return new Response(
            JSON.stringify({ error: "Too many image requests. Try again in a minute." }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }

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

        try {
          const result = await generatePetalImage({
            prompt,
            aspectRatio: body.aspectRatio,
          });
          return new Response(JSON.stringify({ url: result.url, cached: result.cached }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              // Surface the URL to any cross-origin preview that needs it.
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Image generation failed";
          console.error("/api/generate-image error", e);
          // Map gateway errors to friendly statuses.
          const status = /402/.test(message) ? 402 : /429/.test(message) ? 429 : 500;
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
            "Access-Control-Allow-Headers": "content-type",
          },
        });
      },
    },
  },
});
