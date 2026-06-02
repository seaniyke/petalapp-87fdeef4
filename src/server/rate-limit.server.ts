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

// Map<bucket, Map<key, number[]>> of request timestamps (ms).
const buckets = new Map<string, Map<string, number[]>>();

// Periodic GC so the maps can't grow unbounded across long-lived workers.
const GC_EVERY = 5_000;
let opsSinceGc = 0;

function gc(now: number) {
  for (const [bucket, inner] of buckets) {
    for (const [key, arr] of inner) {
      const trimmed = arr.filter((t) => now - t < HOUR_MS);
      if (trimmed.length === 0) inner.delete(key);
      else inner.set(key, trimmed);
    }
    if (inner.size === 0) buckets.delete(bucket);
  }
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
  reason?: "per_minute" | "per_hour";
}

/**
 * Generic sliding-window limiter. Two windows per key:
 *   - perMin  requests / minute / key  (burst protection)
 *   - perHour requests / hour   / key  (sustained-abuse protection)
 *
 * `bucket` namespaces different surfaces (e.g. "generate", "registrar")
 * so they don't share counters.
 */
export function checkRateLimit(
  bucket: string,
  key: string,
  perMin: number,
  perHour: number,
): RateLimitResult {
  const now = Date.now();
  opsSinceGc++;
  if (opsSinceGc >= GC_EVERY) {
    opsSinceGc = 0;
    gc(now);
  }

  let inner = buckets.get(bucket);
  if (!inner) {
    inner = new Map();
    buckets.set(bucket, inner);
  }
  const arr = inner.get(key) ?? [];
  const recentMin = arr.filter((t) => now - t < MINUTE_MS);
  const recentHr = arr.filter((t) => now - t < HOUR_MS);

  if (recentMin.length >= perMin) {
    const oldest = recentMin[0];
    return {
      ok: false,
      reason: "per_minute",
      retryAfterSec: Math.max(1, Math.ceil((MINUTE_MS - (now - oldest)) / 1000)),
    };
  }
  if (recentHr.length >= perHour) {
    const oldest = recentHr[0];
    return {
      ok: false,
      reason: "per_hour",
      retryAfterSec: Math.max(1, Math.ceil((HOUR_MS - (now - oldest)) / 1000)),
    };
  }

  recentHr.push(now);
  inner.set(key, recentHr);
  return { ok: true };
}

/** Back-compat wrapper for /api/generate (30/min, 500/hr per user). */
export function checkGenerateRateLimit(userId: string): RateLimitResult {
  return checkRateLimit("generate", userId, 30, 500);
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

