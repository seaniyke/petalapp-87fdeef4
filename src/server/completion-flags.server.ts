/**
 * Feature switches for the V1-completion work (Phases 3 and 4).
 *
 * Every flag is ON by default and can be killed with an env var, so a bad
 * rollout is a one-variable revert to the pre-existing behaviour rather than
 * a redeploy of the pipeline.
 *
 *   PETAL_INITIAL_BUILD_TOOLS=off   → first builds generate blind again
 *   PETAL_BACKEND_ACCEPTANCE=off    → no live backend probe after a deploy
 */

function enabled(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "off", "false", "no", "disabled"].includes(raw);
}

/** Phase 3 — let the initial build use the inspect/check tool loop. */
export function initialBuildToolsEnabled(): boolean {
  return enabled("PETAL_INITIAL_BUILD_TOOLS");
}

/** Phase 4 — probe the project's real backend after a successful deploy. */
export function backendAcceptanceEnabled(): boolean {
  return enabled("PETAL_BACKEND_ACCEPTANCE");
}

/**
 * Tighter round cap for the first build than follow-up edits get. The first
 * turn is already the most expensive one; two rounds is enough to read back
 * what was just written and run the static check.
 */
export const INITIAL_BUILD_MAX_ROUNDS = 2;
