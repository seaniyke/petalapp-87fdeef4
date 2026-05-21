/**
 * Model kill-switch.
 *
 * In-process counter that tracks recent `no_edit_emitted` (and related
 * hard-fail) outcomes per model. When a model crosses the failure-rate
 * threshold inside a rolling window, it gets "kill-switched" — the
 * generate pipeline skips it in favour of the next entry in the fallback
 * chain until the cool-off expires.
 *
 * This is deliberately a per-instance in-memory store. The Worker is
 * stateless per request, so the counter resets cheaply on deploy / cold
 * start. For globally-coherent enforcement we would use the admin
 * telemetry tables — but a fast in-process guard is enough to break the
 * "all calls on this instance keep hitting the same broken model" loop
 * the user kept reporting.
 */
type Bucket = {
  total: number;
  failures: number;
  firstAt: number;
  killUntil: number;
};

const WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
const MIN_SAMPLE = 20;            // need at least N calls before tripping
const TRIP_RATE = 0.05;           // >5% no_edit_emitted ⇒ kill
const COOL_OFF_MS = 30 * 60 * 1000; // 30 min cool-off

const buckets = new Map<string, Bucket>();

function getOrInit(model: string): Bucket {
  const now = Date.now();
  const existing = buckets.get(model);
  if (!existing || now - existing.firstAt > WINDOW_MS) {
    const fresh: Bucket = { total: 0, failures: 0, firstAt: now, killUntil: existing?.killUntil ?? 0 };
    buckets.set(model, fresh);
    return fresh;
  }
  return existing;
}

/** Record an outcome for a model. Call once per generation turn. */
export function recordModelOutcome(model: string | null | undefined, ok: boolean): void {
  if (!model) return;
  const b = getOrInit(model);
  b.total += 1;
  if (!ok) b.failures += 1;
  if (b.total >= MIN_SAMPLE && b.failures / b.total > TRIP_RATE) {
    if (b.killUntil < Date.now() + COOL_OFF_MS) {
      b.killUntil = Date.now() + COOL_OFF_MS;
      console.warn(
        `[kill-switch] tripping ${model}: ${b.failures}/${b.total} failures in window. Cooling off ${COOL_OFF_MS / 60000}min.`,
      );
    }
  }
}

/** True if the model is currently kill-switched and should be skipped. */
export function isModelKilled(model: string | null | undefined): boolean {
  if (!model) return false;
  const b = buckets.get(model);
  return !!b && b.killUntil > Date.now();
}

/** Diagnostic snapshot for admin telemetry surfaces. */
export function killSwitchSnapshot(): Array<{
  model: string;
  total: number;
  failures: number;
  killUntilMs: number;
}> {
  return [...buckets.entries()].map(([model, b]) => ({
    model,
    total: b.total,
    failures: b.failures,
    killUntilMs: b.killUntil,
  }));
}
