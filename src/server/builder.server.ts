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
import { freshenStaleYears } from "@/server/freshen-stale-years.server";

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
  /**
   * Skip the "Powered by Petal" badge injection. Defaults to false so EVERY
   * build pathway shows the badge unless the caller explicitly opts out
   * (e.g. paid-plan project that has hidden the badge in settings).
   */
  hideBadge?: boolean;
}): Promise<void> {
  const builderUrl = process.env.BUILDER_URL;
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!builderUrl) throw new Error("BUILDER_URL is not configured");
  if (!sharedSecret) throw new Error("BUILDER_SHARED_SECRET is not configured");

  // Rewrite stale copyright years (e.g. "© 2024" → "© 2026") that the LLM
  // emitted from its training-data cutoff. Cheap, runs on every build.
  const { files: yearFreshened, replacements: yearReplacements } = freshenStaleYears(args.files);
  if (yearReplacements > 0) {
    console.log(`[builder] freshened ${yearReplacements} stale year reference(s)`);
  }
  const filesToShip = args.hideBadge ? yearFreshened : injectPetalBadge(yearFreshened);

  const body = JSON.stringify({
    projectId: args.projectId,
    buildId: args.buildId,
    files: filesToShip,
  });
  const { timestamp, signature } = signRequest(sharedSecret, body);

  // Strip trailing slash so we don't double-up on `/build`.
  const url = builderUrl.replace(/\/+$/, "") + "/build";

  // Bound the request. Railway responds 202 in well under a second once warm,
  // but cold containers can take 10-20s to accept the connection. Allow one
  // retry on transient network errors / aborts so a single cold start or
  // dropped TCP connection doesn't surface as "Could not reach build service".
  const attempt = async (timeoutMs: number): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
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
  };

  const isTransient = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.name : "";
    return (
      name === "AbortError" ||
      /aborted|fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|terminated/i.test(msg)
    );
  };

  let res: Response;
  try {
    res = await attempt(45_000);
  } catch (err) {
    if (!isTransient(err)) throw err;
    console.warn("[builder] first attempt failed, retrying once:", err instanceof Error ? err.message : err);
    // Brief backoff to give Railway time to finish cold-starting.
    await new Promise((r) => setTimeout(r, 1500));
    try {
      res = await attempt(60_000);
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(`Builder unreachable after retry: ${msg}`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Builder rejected request (${res.status}): ${text.slice(0, 300)}`);
  }
}
