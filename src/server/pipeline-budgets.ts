/**
 * Pipeline budgets — single source of truth for every limit, ceiling, and
 * timeout the build pipeline enforces.
 *
 * Before this module existed, knobs were scattered across ~15 files:
 *   - file-budget.server.ts had file size/line caps
 *   - credit-pricing.server.ts had BUILD_FLOOR
 *   - ai-provider.server.ts had timeout tiers
 *   - generate.ts had completion_budget heuristics, retry counts, autofix caps
 *   - smart-router had min_samples / window_hours
 *   - idea-coach had MAX_COACH_TURNS
 *
 * Drift was real: an "increase the file cap" change had to touch the prompt,
 * the verifier message, AND the warn/reject thresholds in three places. With
 * everything centralized here, tuning per-plan-tier (free vs paid) or per-
 * experiment becomes a one-line change.
 *
 * Legacy modules continue to export their original constants; new code should
 * import from here. When the legacy locations are next touched, switch them
 * to re-export from this module so there's only ever one numeric literal.
 */

// ────────────────────────────────────────────────────────────────────────
// File-size budget (enforced by file-budget.server.ts)
// ────────────────────────────────────────────────────────────────────────

/** Soft cap. Beyond this the autofix pass is asked to split the file. */
export const MAX_FILE_LINES = 180;
export const MAX_FILE_BYTES = 6 * 1024;

/** Hard reject. Above this we revert to the previous safe version if any. */
export const HARD_REJECT_LINES = 280;
export const HARD_REJECT_BYTES = 10 * 1024;

// ────────────────────────────────────────────────────────────────────────
// Project shape
// ────────────────────────────────────────────────────────────────────────

/** Plan stage cap — max files the plan tool may emit. */
export const MAX_PLANNED_FILES = 8;

/** Soft target for "small MVP" turns. */
export const TARGET_INITIAL_FILES = 6;

// ────────────────────────────────────────────────────────────────────────
// Retry / autofix / agent-loop bounds
// ────────────────────────────────────────────────────────────────────────

/** Structured-retry attempts after a tool-call parse failure. */
export const MAX_STRUCTURED_RETRIES = 2;

/** Post-stream autofix rounds. Bumped so the verifier–fix cycle can converge
 *  on complex builds without giving up early. */
export const MAX_AUTOFIX_ROUNDS = 2;

/** Agent-loop (labs) — max tool calls per turn. Each cycle is billed. */
export const AGENT_LOOP_MAX_STEPS = 12;

/** Agent-loop — hard token ceiling (input+output) for the entire loop. */
export const AGENT_LOOP_MAX_TOKENS = 200_000;

// ────────────────────────────────────────────────────────────────────────
// Streaming timeouts (consumed by ai-provider.server.ts dispatch)
// ────────────────────────────────────────────────────────────────────────

/** Non-streaming JSON calls (triage, classify, plan, memory). */
export const TIMEOUT_DEFAULT_MS = 45_000;

/** Streaming generate/discuss turns. Users can wait; never cut a live stream
 *  short on the wall clock — the idle watchdog in generate.ts is the real
 *  liveness check. */
export const TIMEOUT_STREAM_MS = 900_000;

/** Initial-build streams — multi-file scaffolds may take many minutes on
 *  large asks. Matches TIMEOUT_STREAM_MS. */
export const TIMEOUT_STREAM_FIRST_BUILD_MS = 900_000;

// ────────────────────────────────────────────────────────────────────────
// Credit gates
// ────────────────────────────────────────────────────────────────────────

/** Minimum credit charge per build, applied after settlement true-up. */
export const BUILD_FLOOR = 1.0;

// ────────────────────────────────────────────────────────────────────────
// Smart router (telemetry-driven model selection)
// ────────────────────────────────────────────────────────────────────────

export const ROUTER_DEFAULT_MIN_SAMPLES = 3;
export const ROUTER_DEFAULT_WINDOW_HOURS = 168; // 7 days
export const ROUTER_DEFAULT_EXPLORATION_PCT = 0;
export const ROUTER_CACHE_TTL_MS = 5 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────
// Coach
// ────────────────────────────────────────────────────────────────────────

export const MAX_COACH_TURNS = 4;
