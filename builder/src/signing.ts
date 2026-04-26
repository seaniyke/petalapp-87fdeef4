/**
 * HMAC-SHA256 verification used by both the builder service (incoming /build
 * requests) and our app's Worker (outgoing webhook callbacks). Symmetric secret
 * shared via the `BUILDER_SHARED_SECRET` env var on both sides.
 *
 * Header convention:
 *   x-petal-timestamp: unix seconds when the request was signed
 *   x-petal-signature: hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))
 *
 * Reject signatures older than 5 minutes to prevent replay.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 5 * 60;

export function sign(secret: string, body: string): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { timestamp, signature };
}

export function verify(
  secret: string,
  body: string,
  timestamp: string | undefined,
  signature: string | undefined
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
