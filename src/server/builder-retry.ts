/**
 * Shared retry for calls into the build server.
 *
 * The build server refuses new work with a retryable 503 (+ Retry-After) while
 * a deploy drains it, and the proxy in front answers 502/504 for the few
 * seconds the container is being swapped. None of those mean the request
 * failed — the work just hasn't found a builder yet — so callers wait and
 * re-send instead of surfacing an error.
 *
 * Network errors are retried only when the caller says the endpoint is safe to
 * re-send (the builder de-duplicates /build by build id and /agent/generate by
 * turn id). Sub-calls like /exec and /browse retry status codes only: those
 * prove the request never reached the builder.
 */
export const RETRYABLE_BUILDER_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** Longest Retry-After we honour, so a bad header can't stall a request. */
const MAX_RETRY_AFTER_MS = 30_000;

export function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const s = Number(raw);
  if (!Number.isFinite(s) || s < 0) return null;
  return Math.min(s * 1000, MAX_RETRY_AFTER_MS);
}

export type BuilderRetryOptions = {
  /** Wait before each re-send; its length is the number of retries. */
  delaysMs: readonly number[];
  /** Re-send after a thrown network error (only for de-duplicated endpoints). */
  retryNetworkErrors: boolean;
  /** Stop retrying once the next wait would end after this many ms in total. */
  maxTotalMs?: number;
  /** Caller cancellation: never retry once aborted. */
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `send` until it returns a non-retryable response or retries run out.
 * Returns the last Response (which may still be a retryable status), or
 * throws the last network error.
 */
export async function sendWithBuilderRetry(
  send: (attempt: number) => Promise<Response>,
  opts: BuilderRetryOptions,
): Promise<Response> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const started = now();
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let error: unknown = null;
    try {
      res = await send(attempt);
    } catch (e) {
      error = e;
    }
    if (res && !RETRYABLE_BUILDER_STATUSES.has(res.status)) return res;
    if (!res && (!opts.retryNetworkErrors || opts.signal?.aborted)) throw error;

    const planned = opts.delaysMs[attempt];
    const hinted = res ? retryAfterMs(res) : null;
    const waitMs = planned === undefined ? undefined : Math.max(planned, hinted ?? 0);
    const outOfTime =
      waitMs === undefined ||
      opts.signal?.aborted ||
      (opts.maxTotalMs !== undefined && now() - started + waitMs > opts.maxTotalMs);
    if (outOfTime) {
      if (res) return res;
      throw error;
    }
    if (res) await res.text().catch(() => ""); // free the connection
    opts.onRetry?.({
      attempt: attempt + 1,
      waitMs,
      reason: res ? `status ${res.status}` : error instanceof Error ? error.message : String(error),
    });
    await sleep(waitMs);
  }
}
