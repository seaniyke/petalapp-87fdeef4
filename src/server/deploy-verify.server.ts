/**
 * Post-deploy verification — AI Generation Bible §8.
 *
 * "Deployment is verified after the fact: the deployed URL must return 200 and
 *  render non-empty. Failed deploys never overwrite the last known-good
 *  preview."
 *
 * Until this existed, Petal marked a build "ready" purely because the external
 * builder said so. When the builder's own report was optimistic — a 502 from
 * the static host, an empty `<div id="root">` from a crashed bundle — the user
 * got a white screen labelled "Live".
 *
 * This is an independent, server-side second opinion: fetch the URL Petal is
 * about to point users at, and check it actually serves an app.
 */

export interface DeployProbeResult {
  ok: boolean;
  status: number | null;
  bytes: number;
  /** Machine-readable failure cause; null when ok. */
  reason: "unreachable" | "http_error" | "empty_body" | "no_mount" | null;
  /** User-legible one-liner. Empty when ok. */
  message: string;
}

const TIMEOUT_MS = 30_000;

/** Below this a "page" is a host error page or an empty shell, not an app. */
const MIN_BODY_BYTES = 200;

export async function probeDeployedUrl(url: string): Promise<DeployProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "PetalDeployVerifier/1.0" },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        bytes: 0,
        reason: "http_error",
        message: `The deployed app answered with HTTP ${res.status}.`,
      };
    }

    const body = await res.text();
    const bytes = body.length;

    if (bytes < MIN_BODY_BYTES) {
      return {
        ok: false,
        status: res.status,
        bytes,
        reason: "empty_body",
        message: "The deployed app returned an empty page.",
      };
    }

    // An SPA shell is legitimately small, but it must at least carry a mount
    // point and a script tag — otherwise nothing can ever render.
    const hasMount = /<div[^>]+id=["'](root|app)["']/i.test(body);
    const hasScript = /<script[^>]+src=/i.test(body);
    if (!hasMount && !hasScript) {
      return {
        ok: false,
        status: res.status,
        bytes,
        reason: "no_mount",
        message: "The deployed page has no app mount point, so it would render blank.",
      };
    }

    return { ok: true, status: res.status, bytes, reason: null, message: "" };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      status: null,
      bytes: 0,
      reason: "unreachable",
      message: aborted
        ? "The deployed app didn't respond in time."
        : "Petal couldn't reach the deployed app.",
    };
  } finally {
    clearTimeout(timer);
  }
}
