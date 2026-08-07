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

const VISUAL_DEFECT_PREFIX = /^Visual QA \(/i;
const BLOCKING_RUNTIME_PATTERNS = [
  /rendered a blank page/i,
  /threw an uncaught error/i,
  /framework\/error screen/i,
  /\bpage error\b/i,
  /\bconsole error\b/i,
  /HTTP (?:4\d\d|5\d\d)/i,
  /failed request/i,
  /sign[- ]?up.*failed|sign[- ]?in.*failed/i,
  /flow ".*" failed/i,
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

/** Screenshot craft findings should drive a later polish pass, but they must
 * not replace a functioning preview. Runtime failures are promotion blockers. */
export function partitionVerificationDefects(value: unknown): {
  blocking: string[];
  visual: string[];
  advisory: string[];
} {
  const defects = sanitizeVerificationDefects(value);
  const blocking: string[] = [];
  const visual: string[] = [];
  const advisory: string[] = [];
  for (const defect of defects) {
    if (VISUAL_DEFECT_PREFIX.test(defect)) visual.push(defect);
    else if (BLOCKING_RUNTIME_PATTERNS.some((pattern) => pattern.test(defect))) blocking.push(defect);
    else advisory.push(defect);
  }
  return { blocking, visual, advisory };
}