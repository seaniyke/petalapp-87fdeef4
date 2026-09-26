/**
 * Bounded provider retry for transient infrastructure failures.
 *
 * Retries only 429 / 500 / 502 / 503 / 504 and connection errors, with
 * bounded exponential backoff + jitter. Deterministic request errors (4xx
 * other than 429) are never retried. Model/provider selection is unchanged —
 * the same call is re-issued. Every attempt is recorded so infrastructure
 * failures stay distinguishable from code failures.
 */
export const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
export const MAX_PROVIDER_RETRIES = 2;
export const BASE_DELAY_MS = 800;
export const MAX_DELAY_MS = 6_000;

export interface ProviderAttempt {
  attempt: number;
  status: number | null;
  failureClass: "rate_limited" | "server_error" | "connection" | "ok" | "deterministic";
  delayMs: number;
}

export function classifyProviderStatus(status: number | null): ProviderAttempt["failureClass"] {
  if (status === null) return "connection";
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "rate_limited";
  if (RETRYABLE_STATUS.has(status)) return "server_error";
  return "deterministic";
}

export function backoffDelay(attempt: number, random = Math.random): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export async function withProviderRetry(
  run: () => Promise<Response>,
  opts: { signal?: AbortSignal; onAttempt?: (a: ProviderAttempt) => void; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<Response> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_PROVIDER_RETRIES + 1; attempt++) {
    let status: number | null = null;
    try {
      last = await run();
      status = last.status;
      lastErr = null;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      lastErr = e;
      last = null;
    }
    const cls = classifyProviderStatus(status);
    const retry = (cls === "rate_limited" || cls === "server_error" || cls === "connection") && attempt <= MAX_PROVIDER_RETRIES && !opts.signal?.aborted;
    const delayMs = retry ? backoffDelay(attempt, opts.random) : 0;
    opts.onAttempt?.({ attempt, status, failureClass: cls, delayMs });
    if (!retry) break;
    try { await last?.body?.cancel(); } catch { /* ignore */ }
    await sleep(delayMs);
  }
  if (last) return last;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
