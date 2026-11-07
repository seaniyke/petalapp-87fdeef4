/**
 * Client for the external Kimble Builder service running on Railway.
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
import { injectCustardWidget } from "@/server/custard-widget.server";
import { fixSourceEscapes } from "@/server/source-escape-fixer.server";
import { fixImportSyntax } from "@/server/import-syntax-fixer.server";
import { fixJsxAttrLiterals } from "@/server/jsx-attr-literal-fixer.server";
import { fixMarkdownFences } from "@/server/markdown-fence-fixer.server";
import { ensureBrandMarkWired } from "@/server/brand-identity.server";
import type { VerifyPlan } from "@/server/verify-plan.server";
import {
  runScopedBuildCleanup,
  type CleanupScopeMeta,
} from "@/server/build-cleanup-scope.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";
import { pinLooseDeps } from "@/server/pin-loose-deps";
import { sendWithBuilderRetry, RETRYABLE_BUILDER_STATUSES } from "@/server/builder-retry";

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
   * Skip the "Powered by Kimble" badge injection. Defaults to false so EVERY
   * build pathway shows the badge unless the caller explicitly opts out
   * (e.g. paid-plan project that has hidden the badge in settings).
   */
  hideBadge?: boolean;
  /** Add Custard AI's staff widget (apps owned by the Custard service account). */
  custardWidget?: boolean;
  /**
   * Post-deploy browser verification plan. When present the builder loads the
   * deployed app in a real browser, signs a throwaway user in, runs the write
   * flows, and returns findings on the callback.
   */
  verify?: VerifyPlan;
  /** Exact files written by the generation turn. Empty means skip cleanup. */
  cleanupPaths?: string[];
  cleanupMeta?: CleanupScopeMeta;
}): Promise<void> {
  const builderUrl = process.env.BUILDER_URL;
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!builderUrl) throw new Error("BUILDER_URL is not configured");
  if (!sharedSecret) throw new Error("BUILDER_SHARED_SECRET is not configured");

  // Last-mile syntax safety net. Every build pathway funnels through this
  // function, so healing here means no caller can ever ship source that
  // esbuild refuses to parse (literal `\n` in code position, or an import
  // statement missing its `from` keyword). Both passes are pure and
  // idempotent, so running them again after runAllRepairs costs nothing.
  // Absolute final boundary: callers normally run this earlier, but no build
  // may depend on every current or future caller remembering that contract.
  // In particular this guarantees router providers are repaired in the exact
  // payload sent to the external builder, including retries and reships.
  const canonical = runScopedBuildCleanup(args.files, args.cleanupPaths, args.cleanupMeta);
  const cleanupSet = new Set(canonical.scope);
  const selected = canonical.files.filter((file) => cleanupSet.has(file.path));
  const mergeScoped = (base: ProjectFile[], changed: ProjectFile[]): ProjectFile[] => {
    const byPath = new Map(changed.map((file) => [file.path, file]));
    return base.map((file) => byPath.get(file.path) ?? file);
  };
  // These syntax passes are file-local. Running them against only the closed
  // cleanup scope prevents the final ship boundary from rescanning the kit.
  const escapedScoped = fixSourceEscapes(selected);
  const escaped = { ...escapedScoped, files: mergeScoped(canonical.files, escapedScoped.files) };
  const importScoped = fixImportSyntax(escaped.files.filter((file) => cleanupSet.has(file.path)));
  const importHealed = { ...importScoped, files: mergeScoped(escaped.files, importScoped.files) };
  // `prop=[…]` / `prop=42` — unbraced JSX attribute values also abort the
  // esbuild transform ("Expected \"{\" but found \"[\"").
  const attrScoped = fixJsxAttrLiterals(importHealed.files.filter((file) => cleanupSet.has(file.path)));
  const attrHealed = { ...attrScoped, files: mergeScoped(importHealed.files, attrScoped.files) };
  const fenceScoped = fixMarkdownFences(attrHealed.files.filter((file) => cleanupSet.has(file.path)));
  const fenceHealed = { ...fenceScoped, files: mergeScoped(attrHealed.files, fenceScoped.files) };
  // `<BrandMark/>` with no import compiles fine and then white-screens the
  // published app with `Can't find variable: BrandMark`. Heal it here too so
  // no build pathway can ship it.
  const brandScoped = ensureBrandMarkWired(fenceHealed.files.filter((file) => cleanupSet.has(file.path)));
  const brandWired = { ...brandScoped, files: mergeScoped(fenceHealed.files, brandScoped.files) };

  for (const n of [...canonical.notes, ...escaped.notes, ...importHealed.notes, ...attrHealed.notes, ...fenceHealed.notes, ...brandWired.notes]) {
    console.warn(`[builder-last-mile] project=${args.projectId}: ${n}`);
  }


  // Rewrite stale copyright years (e.g. "© 2024" → "© 2026") that the LLM
  // emitted from its training-data cutoff. Cheap, runs on every build.
  // Infrastructure injection belongs at the final shipping boundary. Older
  // projects can still have a stale inline guard persisted in project_files,
  // and some callers may not have passed through the current trigger route.
  // Replacing it here guarantees the exact payload sent to the builder always
  // contains one current, parse-safe guard.
  const guarded = pinLooseDeps(injectPreviewGuard(brandWired.files, { projectId: args.projectId }).files);
  const badged = args.hideBadge ? guarded : injectPetalBadge(guarded);
  const filesToShip = args.custardWidget ? injectCustardWidget(badged) : badged;

  const body = JSON.stringify({
    projectId: args.projectId,
    buildId: args.buildId,
    files: filesToShip,
    ...(args.verify ? { verify: args.verify } : {}),
  });
  // Strip trailing slash so we don't double-up on `/build`.
  const url = builderUrl.replace(/\/+$/, "") + "/build";

  // Bound each attempt. A warm builder answers 202 in well under a second;
  // a cold one can take 10-20s to accept the connection.
  const attempt = async (n: number): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), n === 0 ? 45_000 : 60_000);
    // Fresh signature per attempt so a late retry never falls outside the
    // receiver's five-minute window.
    const { timestamp, signature } = signRequest(sharedSecret, body);
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

  // Queue pressure (503 busy), a deploy draining the builder (503 +
  // Retry-After), the few-second container swap (502/504 or a refused
  // connection) and upstream blips are NOT failures — the build just hasn't
  // found a builder yet. Re-sending is safe: the builder acknowledges a build
  // id it already holds instead of running it twice.
  let res: Response;
  try {
    res = await sendWithBuilderRetry(attempt, {
      delaysMs: BUILD_DISPATCH_RETRY_DELAYS_MS,
      retryNetworkErrors: true,
      maxTotalMs: BUILD_DISPATCH_MAX_TOTAL_MS,
      onRetry: ({ attempt: n, waitMs, reason }) =>
        console.warn(`[builder] ${reason} — retrying in ${waitMs}ms (attempt ${n + 1})`),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Builder unreachable after retry: ${msg}`);
  }
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  if (RETRYABLE_BUILDER_STATUSES.has(res.status)) {
    throw new Error(
      "The build queue is full right now. Your files are saved — press Retry in a moment and Kimble will pick up where it left off.",
    );
  }
  throw new Error(`Builder rejected request (${res.status}): ${text.slice(0, 300)}`);
}

/**
 * Wait schedule for handing a build to the builder: about 2 minutes in total,
 * which covers a deploy's drain + container swap with room to spare.
 */
export const BUILD_DISPATCH_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 45_000] as const;
export const BUILD_DISPATCH_MAX_TOTAL_MS = 150_000;

