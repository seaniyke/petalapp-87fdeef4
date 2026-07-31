/**
 * Shared in-memory rate limiter for unauthenticated public endpoints.
 *
 * Tip, pledge and waitlist forms accept attacker-controlled name/email/amount
 * and write straight into tables that hold personal data. Without a throttle
 * a single script can flood them. This is the same tiny per-isolate window
 * `track-failure` already used, lifted into one place so every public write
 * shares it.
 *
 * Deliberately in-memory: a Worker isolate handles a few hundred req/s, which
 * is plenty to stop spam, and it costs no database round trip on the happy
 * path. It is a spam brake, not a security boundary — endpoints that need a
 * real guarantee must still verify the caller.
 */

const BUCKETS = new Map<string, { count: number; resetAt: number }>();

/** Best-effort caller identity for throttling. Never used for authorization. */
export function callerKey(request: Request, scope: string): string {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${scope}:${ip}`;
}

/**
 * Returns true when the caller has exceeded `max` requests in `windowMs`.
 */
export function shouldThrottle(
  key: string,
  max = 10,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = BUCKETS.get(key);
  if (!entry || entry.resetAt < now) {
    BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    // Opportunistic sweep so the map can't grow without bound.
    if (BUCKETS.size > 5_000) {
      for (const [k, v] of BUCKETS) if (v.resetAt < now) BUCKETS.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

/** Standard 429 body for throttled public writes. */
export function throttledResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": "60" } },
  );
}

/**
 * Constant-time string comparison for shared secrets.
 *
 * `a !== b` leaks how many leading characters matched through timing. Every
 * cron/webhook secret check should use this instead.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  // Compare a fixed length so the loop count never depends on the secret.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
