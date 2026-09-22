/**
 * Transient-network retry.
 *
 * WHY THIS EXISTS
 * ---------------
 * A turn can finish perfectly and still end in a scary card: the phone hops
 * from Wi-Fi to LTE while Kimble is writing the result back, one `fetch`
 * rejects with Safari's `TypeError: Load failed`, and the user sees "Kimble is
 * picking this back up" underneath a recap that already says the work is done.
 * Nothing was wrong with the app; a socket died for 200ms.
 *
 * These failures are indistinguishable from success on a retry, so retry them
 * rather than reporting them. Only genuinely transient transport errors are
 * retried — an HTTP 4xx or a thrown application error is returned immediately.
 */

const TRANSIENT_RE =
  /\b(load failed|failed to fetch|fetch failed|network ?error|networkerror|connection (closed|reset|refused)|socket hang up|econnreset|etimedout|the operation (was|couldn't be) (aborted|completed)|error code:\s*1016)\b/i;

/** True when the error looks like a dropped socket rather than a real failure. */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : "";
  if (!msg) return false;
  return TRANSIENT_RE.test(msg);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying only transient network failures with exponential backoff.
 * `fn` must be idempotent — every caller here is an upsert or an append that
 * is safe to repeat.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 500;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransientNetworkError(e) || i === attempts - 1) throw e;
      await sleep(base * 2 ** i);
    }
  }
  throw last;
}
