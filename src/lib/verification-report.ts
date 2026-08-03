const VERIFIER_INTERNAL_ERROR_PATTERNS = [
  /DOM probe failed:/i,
  /DOM probe returned no result/i,
  /Cannot read properties of (?:undefined|null) \(reading ['"]blank['"]\)/i,
  /(?:undefined|null) is not an object \(evaluating ['"].*\.blank['"]\)/i,
];

/**
 * Speculative-flow noise: the verifier invents generic user journeys ("Submit
 * multi-step form", "Search for a destination") and reports a timeout when the
 * element it guessed at simply does not exist in this app. A locator that was
 * never found is a wrong assumption by the checker, not a defect in the app.
 */
const SPECULATIVE_FLOW_PATTERNS = [
  /Flow ".*" failed at step[\s\S]*locator\.\w+: Timeout \d+ms exceeded/i,
  /Flow ".*" failed at step[\s\S]*waitForURL: Timeout \d+ms exceeded/i,
  /Flow ".*" failed at step[\s\S]*waiting for locator\(/i,
];

/**
 * Browser-check instrumentation failures describe Petal's verifier, not the
 * generated app. They must stay in service logs and never trigger repairs or
 * appear as user-facing app defects.
 */
export function isVerifierInternalDefect(value: string): boolean {
  return (
    VERIFIER_INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(value)) ||
    SPECULATIVE_FLOW_PATTERNS.some((pattern) => pattern.test(value))
  );
}


export function sanitizeVerificationDefects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (defect): defect is string =>
          typeof defect === "string" && defect.trim().length > 0 && !isVerifierInternalDefect(defect),
      ),
    ),
  );
}