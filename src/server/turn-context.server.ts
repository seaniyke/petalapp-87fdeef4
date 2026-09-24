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
  /** Set when the attempt's response has finished. */
  ended?: boolean;
  /** AUTHORITATIVE per-turn exclusion set. An upstream that stalled, errored
   *  or returned an empty stream for this generation turn is never picked
   *  again by ANY later call in the same turn (retry, recovery, continuation,
   *  missing-page follow-up, repair). A fresh user turn starts empty. */
  failedUpstreams?: Set<string>;
  /** Set when OpenRouter had no eligible provider left for a code call.
   *  Terminal for the call: it is never re-sent in this turn. */
  providersExhausted?: boolean;
  /** First builds: the model's own summary ("it's live") is never streamed
   *  mid-build. Only the authoritative final result carries the message. */
  holdSummary?: boolean;
  /** ISOLATED inference evaluation (bench account + explicit header only):
   *  Kimble picks the model chain, OpenRouter does provider failover. */
  inferenceEval?: { models: string[] } | null;
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

/** Normalise an OpenRouter upstream name to its routing slug. */
export function upstreamSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

/** Mark an upstream as failed for the given (or current) turn. */
export function markUpstreamFailed(upstream: string | null | undefined, ctx?: TurnContext): void {
  if (!upstream) return;
  const c = ctx ?? currentTurnContext();
  if (!c || Object.keys(c).length === 0) {
    console.warn(`[provider-exclusion] no turn context; cannot exclude ${upstream}`);
    return;
  }
  (c.failedUpstreams ??= new Set()).add(upstreamSlug(upstream));
  console.log(`[provider-exclusion] turn=${c.turnId ?? "?"} excluded=${Array.from(c.failedUpstreams).join(",")}`);
}

/** Upstreams excluded for the current turn. */
export function failedUpstreamsForTurn(ctx?: TurnContext): string[] {
  const c = ctx ?? currentTurnContext();
  return c?.failedUpstreams ? Array.from(c.failedUpstreams) : [];
}

/** Record that no eligible provider was left for a code call this turn. */
export function markProvidersExhausted(ctx?: TurnContext): void {
  const c = ctx ?? currentTurnContext();
  if (c && Object.keys(c).length > 0) c.providersExhausted = true;
}

export function providersExhaustedForTurn(ctx?: TurnContext): boolean {
  const c = ctx ?? currentTurnContext();
  return c?.providersExhausted === true;
}
