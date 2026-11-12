/**
 * Address scheduled jobs use to call Petal's own private routes.
 *
 * Jobs are scheduled against the stable `project--….lovable.app` host, which
 * only lets `/api/public/*` through (everything else answers 403), and
 * `petalapp.lovable.app` forwards every request elsewhere (307). So a job that
 * called back into `/api/generate` on its own request host was refused, and
 * every interrupted build that should have resumed by itself was blocked.
 * Hosted requests use the primary address; local/dev keeps its own origin.
 */
export const PRIMARY_ORIGIN = "https://api.custardai.dev";

export function internalOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return url.hostname.endsWith(".lovable.app") ? PRIMARY_ORIGIN : url.origin;
}
