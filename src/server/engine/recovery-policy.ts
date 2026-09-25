/**
 * THE bounded recovery table. Every recovery decision in the build engine
 * checks here; nothing retries outside these limits.
 */
export type FailureKind =
  | "provider_failure"
  | "truncated_output"
  | "broken_file"
  | "build_failure"
  | "missing_page"
  | "browser_failure";

export const RECOVERY_LIMITS: Readonly<Record<FailureKind, number>> = {
  provider_failure: 2, // same request, next allowed provider (two providers can stall in a row)
  truncated_output: 1, // continue only the missing files
  broken_file: 1, // per file, max MAX_REPAIRED_FILES files
  build_failure: 1, // repair only files named in the error
  missing_page: 1, // generate only the missing page
  browser_failure: 0, // report truthfully
};
export const MAX_REPAIRED_FILES = 3;

export class RecoveryBudget {
  private used = new Map<string, number>();
  /** True (and consumes one attempt) when another attempt is allowed. */
  take(kind: FailureKind, key = ""): boolean {
    const k = `${kind}:${key}`;
    const n = this.used.get(k) ?? 0;
    if (n >= RECOVERY_LIMITS[kind]) return false;
    if (kind === "broken_file" && n === 0) {
      const files = [...this.used.keys()].filter((x) => x.startsWith("broken_file:")).length;
      if (files >= MAX_REPAIRED_FILES) return false;
    }
    this.used.set(k, n + 1);
    return true;
  }
}
