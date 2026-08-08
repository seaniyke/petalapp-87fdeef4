/**
 * PRD — telemetry.
 *
 * Phase 6. One structured line per PRD event so recurring failures can become
 * new archetypes, rules and tests instead of longer prompts.
 *
 * Deliberately log-only: it must never add latency to a build and must never
 * be able to fail one. Log lines are prefixed `[prd-telemetry]` and are a
 * single JSON object so they can be grepped and aggregated as-is.
 */

import type { Prd } from "./prd-types";

export type PrdEvent =
  | "authored"
  | "amended"
  | "gate-passed"
  | "gate-blocked"
  | "repair-applied";

export interface PrdTelemetryArgs {
  event: PrdEvent;
  projectId?: string | null;
  prd: Prd;
  /** Acceptance criteria that failed, when the event is a gate outcome. */
  failedCriteria?: string[];
  /** Surfaces the build actually delivered, when known. */
  deliveredSurfaces?: string[];
  amendment?: string;
  confidence?: number;
}

export function recordPrdEvent(args: PrdTelemetryArgs): void {
  try {
    const payload = {
      event: args.event,
      projectId: args.projectId ?? null,
      product: args.prd.productName,
      productType: args.prd.productType,
      required: args.prd.requiredSurfaces,
      excluded: args.prd.excludedSurfaces,
      delivered: args.deliveredSurfaces ?? null,
      failed: args.failedCriteria ?? null,
      amendment: args.amendment ?? null,
      confidence: args.confidence ?? args.prd.confidence,
      source: args.prd.source,
      at: new Date().toISOString(),
    };
    console.log(`[prd-telemetry] ${JSON.stringify(payload)}`);
  } catch {
    /* telemetry must never affect a build */
  }
}
