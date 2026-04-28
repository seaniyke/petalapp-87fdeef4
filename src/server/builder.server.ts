/**
 * Client for the external Petal Builder service running on Railway.
 *
 * The builder receives a project's files, runs `npm install` + `vite build`,
 * and deploys the result to Cloudflare Pages. It then calls back to
 * `/api/public/builds/callback` with the deployment URL or an error.
 *
 * Both directions are HMAC-SHA256 signed using `BUILDER_SHARED_SECRET`.
 * Header convention (mirrors `builder/src/signing.ts` exactly):
 *   x-petal-timestamp: unix seconds when the request was signed
 *   x-petal-signature: hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProjectFile } from "@/server/generate.server";
import { injectPetalBadge } from "@/server/petal-badge.server";

const MAX_AGE_SECONDS = 5 * 60;

export function signRequest(
  secret: string,
  body: string
): { timestamp: string; signature: string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return { timestamp, signature };
}

export function verifySignature(
  secret: string,
  body: string,
  timestamp: string | undefined | null,
  signature: string | undefined | null
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(signature, "hex");
    b = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST a build request to the Railway builder. Builder responds 202 immediately
 * and runs the build asynchronously. Result is delivered via the callback route.
 *
 * Throws if the network call fails or the builder rejects the request (4xx/5xx).
 */
export async function postBuildToRailway(args: {
  projectId: string;
  buildId: string;
  files: ProjectFile[];
}): Promise<void> {
  const builderUrl = process.env.BUILDER_URL;
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!builderUrl) throw new Error("BUILDER_URL is not configured");
  if (!sharedSecret) throw new Error("BUILDER_SHARED_SECRET is not configured");

  const body = JSON.stringify({
    projectId: args.projectId,
    buildId: args.buildId,
    files: args.files,
  });
  const { timestamp, signature } = signRequest(sharedSecret, body);

  // Strip trailing slash so we don't double-up on `/build`.
  const url = builderUrl.replace(/\/+$/, "") + "/build";

  // Bound the request — Railway responds 202 in well under a second once warm.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-petal-timestamp": timestamp,
        "x-petal-signature": signature,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Builder rejected request (${res.status}): ${text.slice(0, 300)}`);
  }
}
