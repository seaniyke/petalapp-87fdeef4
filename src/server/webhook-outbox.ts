/**
 * Pure rules for partner webhook delivery (no I/O, unit-tested).
 *
 * A notification is tried inline first; if the receiver is unreachable it is
 * kept in `webhook_deliveries` and retried by the build-watchdog cron tick.
 */

/** Delays after each failed outbox attempt: 1m, 5m, 15m, 1h, 3h, 6h. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000];

/** When the next attempt is due after `attempts` failed outbox tries, or null when exhausted. */
export function nextRetryDelayMs(attempts: number): number | null {
  if (attempts < 0) return RETRY_DELAYS_MS[0];
  return attempts < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempts] : null;
}

/** A receiver answer we should retry: network error (null), 408, 429, or 5xx. */
export function isRetryableStatus(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || status >= 500;
}
