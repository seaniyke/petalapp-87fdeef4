/**
 * Ambient turn context.
 *
 * Phase 1 of the builder upgrade: every AI call must be attributable to the
 * user turn that caused it. Before this, only the streamed `generate` calls
 * passed `meta.turnId` explicitly — the ~1,000 utility calls per month
 * (preflight, triage, memory, design, recovery) carried no project, user or
 * turn at all, which made cost-per-turn and cost-per-build uncomputable.
 *
 * Rather than threading four arguments through ~35 call sites (and missing
 * some), the turn is entered ONCE in `api/generate` and read as a default
 * inside `recordTelemetry`. Explicit `meta` always wins.
 *
 * Implemented with AsyncLocalStorage, which workerd supports under
 * nodejs_compat. If the runtime ever lacks it we degrade to "no ambient
 * context" — telemetry keeps working exactly as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface TurnContext {
  turnId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  buildId?: string | null;
  /** Unique per HTTP request. A resumed/retried turn gets a new attempt, so
   *  overlapping or abandoned attempts can never be aggregated together. */
  attemptId?: string | null;
  /** Aborts when this attempt is cancelled; calls made afterwards are tagged. */
  signal?: AbortSignal | null;
}

let storage: AsyncLocalStorage<TurnContext> | null = null;
try {
  storage = new AsyncLocalStorage<TurnContext>();
} catch {
  storage = null;
}

/** Run `fn` with the given turn attached to every AI call it makes. */
export async function runWithTurnContext<T>(ctx: TurnContext, fn: () => Promise<T>): Promise<T> {
  if (!storage) return fn();
  return storage.run(ctx, fn);
}

/** Current turn, or an empty object when called outside a turn. */
export function currentTurnContext(): TurnContext {
  try {
    return storage?.getStore() ?? {};
  } catch {
    return {};
  }
}
