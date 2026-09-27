/**
 * Kimble Credit System v2 — build cost transparency.
 *
 * After every successful build we tell the user, in plain language, what
 * their credits paid for. Deliberate rules:
 *   - Never expose token counts, model names, or provider pricing.
 *   - Never show a cost line for work Kimble did on its own tab
 *     (auto-repair, retries, verification retries, deployment retries).
 *   - A zero charge is stated explicitly as free, not hidden.
 */

export type BuildCostInput = {
  /** Credits actually settled for this turn. */
  credits: number | null | undefined;
  /** Files written in this turn. */
  fileCount?: number;
  /** Paths written — used to tell whether backend work happened. */
  paths?: string[];
  /** Whether Kimble's quality gates ran on this turn. */
  verified?: boolean;
};

const BACKEND_HINTS = [
  "supabase/",
  "/api/",
  ".server.",
  ".functions.",
  "migrations/",
  "server/",
];

export function isBackendPath(path: string): boolean {
  const p = path.toLowerCase();
  return BACKEND_HINTS.some((h) => p.includes(h));
}

/** Human-readable bullets explaining what the credits covered. */
export function buildCostReasons(input: BuildCostInput): string[] {
  const credits = Number(input.credits ?? 0);
  if (!(credits > 0)) return [];

  const paths = input.paths ?? [];
  const reasons = ["Understanding your request"];

  if ((input.fileCount ?? paths.length) > 0) {
    reasons.push("Writing and updating your app's code");
  }
  if (paths.some(isBackendPath)) {
    reasons.push("Setting up backend logic and data rules");
  }
  reasons.push("Design and product reasoning");
  if (input.verified !== false) {
    reasons.push("Checking the result before showing it to you");
  }
  return reasons;
}

/** "1 credit" / "2.4 credits" / "Free — Kimble's own repair pass". */
export function formatBuildCost(credits: number | null | undefined): string {
  if (typeof credits !== "number") return "—";
  if (credits <= 0) return "Free";
  if (credits === 1) return "1 credit";
  // Small measured charges keep 2 decimals so 0.07 never reads as "0.1".
  if (credits < 1) return `${credits.toFixed(2)} credits`;
  const rounded = Math.round(credits * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} credits`;
}

/** Single trust line shown under the cost. */
export function costFootnote(credits: number | null | undefined): string {
  if (typeof credits !== "number" || credits <= 0) {
    return "Kimble fixed this one on its own tab — you were not charged.";
  }
  return "You're only charged for successful builds. Repairs, retries and publishing are always free.";
}
