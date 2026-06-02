/**
 * App-level rate limiter for /api/generate (P0-4).
 *
 * Sliding-window, in-memory, per-worker-instance. Cloudflare Workers
 * scale horizontally, so the effective ceiling is `instances × LIMIT`.
 * That's intentional — this is an abuse-protection floor, not a billing
 * boundary (billing is enforced by the credit wallet).
 *
 * Two windows are checked per request:
 *   - 30 requests / minute / user  (burst protection)
 *   - 500 requests / hour / user   (sustained-abuse protection)
 *
 * On breach we return 429 with a `Retry-After` header so well-behaved
 * clients back off, and we never charge credits for a rate-limited
 * request (the limiter runs before the credit floor check).
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const PER_MIN = 30;
const PER_HOUR = 500;

// Map<userId, number[]> of request timestamps (ms). Trimmed on every check.
const hits = new Map<string, number[]>();

// Periodic GC so the map can't grow unbounded across long-lived workers.
const GC_EVERY = 5_000;
let opsSinceGc = 0;

function gc(now: number) {
  for (const [uid, arr] of hits) {
    const trimmed = arr.filter((t) => now - t < HOUR_MS);
    if (trimmed.length === 0) hits.delete(uid);
    else hits.set(uid, trimmed);
  }
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
  reason?: "per_minute" | "per_hour";
}

export function checkGenerateRateLimit(userId: string): RateLimitResult {
  const now = Date.now();
  opsSinceGc++;
  if (opsSinceGc >= GC_EVERY) {
    opsSinceGc = 0;
    gc(now);
  }

  const arr = hits.get(userId) ?? [];
  const recentMin = arr.filter((t) => now - t < MINUTE_MS);
  const recentHr = arr.filter((t) => now - t < HOUR_MS);

  if (recentMin.length >= PER_MIN) {
    const oldest = recentMin[0];
    return {
      ok: false,
      reason: "per_minute",
      retryAfterSec: Math.max(1, Math.ceil((MINUTE_MS - (now - oldest)) / 1000)),
    };
  }
  if (recentHr.length >= PER_HOUR) {
    const oldest = recentHr[0];
    return {
      ok: false,
      reason: "per_hour",
      retryAfterSec: Math.max(1, Math.ceil((HOUR_MS - (now - oldest)) / 1000)),
    };
  }

  recentHr.push(now);
  hits.set(userId, recentHr);
  return { ok: true };
}

export function rateLimitResponse(result: RateLimitResult): Response {
  const retry = result.retryAfterSec ?? 60;
  const body = {
    error:
      result.reason === "per_minute"
        ? "You're sending requests too quickly. Please wait a moment and try again."
        : "You've hit the hourly request limit. Please try again later.",
    retryAfterSec: retry,
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retry),
    },
  });
}
