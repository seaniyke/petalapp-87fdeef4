/**
 * Test Lab repair bridge — turning evidence into the smallest next action.
 *
 * The repair machinery already exists (defect judge, agent loop, completion
 * state machine, shared 3-attempt budget). This module is the translation
 * layer between "a browser test failed" and that machinery:
 *
 *   - `defectsFromResults` phrases failures as defect lines the existing
 *     repair loop already understands, with the evidence attached so the
 *     fixer works from what was observed rather than from a guess.
 *   - `interventionFor` recognises the failures no amount of retrying can
 *     fix (a missing credential, a dead third-party service, a real payment,
 *     a CAPTCHA) and stops, rather than burning the budget.
 *   - `retestSelection` decides what to re-run after a fix: the cases that
 *     failed, plus every must-work case that was passing — a repair that
 *     breaks something that used to work is not a repair.
 *   - `nextRepairStep` is the decision itself, bounded by the shared budget.
 *
 * All pure. No IO, no model calls — the caller owns those.
 */
import { MAX_REPAIR_ATTEMPTS } from "@/lib/repair-budget";
import type { TestCase } from "@/server/test-plan.server";
import type { CaseResult } from "@/server/test-results.server";

/** Conditions a code fix cannot resolve. Each stops the loop with an ask. */
export type InterventionKind =
  | "missing_credential"
  | "external_service_down"
  | "payment_required"
  | "captcha"
  | "infrastructure";

export interface Intervention {
  kind: InterventionKind;
  /** Plain-language explanation for the person, no jargon. */
  message: string;
  /** The case that surfaced it. */
  caseKey: string;
  evidence?: string;
}

const INTERVENTION_RULES: Array<{
  kind: InterventionKind;
  pattern: RegExp;
  message: string;
}> = [
  {
    kind: "missing_credential",
    pattern:
      /\b(missing|invalid|no) (api[_ -]?key|secret|token|credential)|unauthori[sz]ed: no key|api key not configured/i,
    message: "A key for one of the outside services this app uses is missing or wrong.",
  },
  {
    kind: "payment_required",
    pattern: /\b(payment|card|checkout) (details|information) required|live card|real payment/i,
    message: "This step needs a real card payment, which testing must never do.",
  },
  {
    kind: "captcha",
    pattern: /\b(captcha|recaptcha|hcaptcha|are you a robot|human verification)\b/i,
    message: "A human verification step blocks automated testing here.",
  },
  {
    kind: "external_service_down",
    pattern: /\b(50[0234]|502 bad gateway|service unavailable|ENOTFOUND|getaddrinfo)\b/i,
    message: "An outside service this app depends on is not responding right now.",
  },
  {
    kind: "infrastructure",
    pattern: /\b(ERR_CONNECTION_REFUSED|ERR_TUNNEL|deployment not found|404 from host)\b/i,
    message: "The app itself could not be reached, so nothing could be tested.",
  },
];

/** The first condition that makes further automatic retries pointless. */
export function interventionFor(results: CaseResult[]): Intervention | null {
  for (const r of results) {
    if (r.status === "passed" || r.status === "skipped") continue;
    const haystack = [r.reason, r.actual, ...r.failedRequests, ...r.consoleErrors]
      .filter(Boolean)
      .join("\n");
    if (!haystack) continue;
    for (const rule of INTERVENTION_RULES) {
      if (rule.pattern.test(haystack)) {
        return {
          kind: rule.kind,
          message: rule.message,
          caseKey: r.caseKey,
          evidence: haystack.slice(0, 400),
        };
      }
    }
  }
  return null;
}

const MAX_DEFECTS = 12;

/**
 * Failures, phrased as defect lines for the existing repair loop. Evidence is
 * inlined so the fixer edits the smallest thing that explains what was seen,
 * instead of rewriting a page on a hunch.
 */
export function defectsFromResults(results: CaseResult[]): {
  blocking: string[];
  advisory: string[];
} {
  const blocking: string[] = [];
  const advisory: string[] = [];

  for (const r of results) {
    if (r.status !== "failed") continue;
    const parts = [`[${r.priority}] ${r.title}`];
    if (r.url) parts.push(`on ${r.url}`);
    parts.push(`— ${r.reason ?? "check failed"}`);
    if (r.expected) parts.push(`(expected: ${r.expected})`);
    if (r.actual) parts.push(`(saw: ${r.actual.slice(0, 200)})`);
    // Both matter, and they usually say different things: the page error is
    // the symptom, the failed request is often the cause (a wrong table name,
    // a 404 endpoint). Dropping either sends the fixer guessing.
    if (r.pageErrors[0]) parts.push(`(page error: ${r.pageErrors[0].slice(0, 200)})`);
    if (r.failedRequests[0])
      parts.push(`(failed request: ${r.failedRequests[0].slice(0, 200)})`);
    const line = parts.join(" ");
    (r.priority === "P0" ? blocking : advisory).push(line);
  }

  return { blocking: blocking.slice(0, MAX_DEFECTS), advisory: advisory.slice(0, MAX_DEFECTS) };
}

/**
 * What to re-run after a repair: everything that failed or was blocked, plus
 * every previously passing P0 case (regression guard). P1/P2 passes are not
 * re-run — that is the cost/benefit trade.
 */
export function retestSelection(cases: TestCase[], results: CaseResult[]): TestCase[] {
  const byKey = new Map(results.map((r) => [r.caseKey, r]));
  return cases.filter((c) => {
    const r = byKey.get(c.id);
    if (!r) return c.priority === "P0";
    if (r.status === "failed" || r.status === "blocked") return true;
    return r.status === "passed" && c.priority === "P0";
  });
}

export type RepairDecision =
  | { action: "accept" }
  | { action: "repair"; attempt: number; blocking: string[]; advisory: string[] }
  | { action: "stop"; reason: string; intervention?: Intervention };

/**
 * The next move after a round of testing. Bounded by the shared repair budget,
 * and never "accept" while a must-work check is failing or untested.
 */
export function nextRepairStep(args: {
  results: CaseResult[];
  /** Repair attempts already spent on this turn. */
  attemptsUsed: number;
  /** Fingerprints of previous rounds, to detect a loop that isn't progressing. */
  previousFingerprint?: string | null;
}): RepairDecision {
  const intervention = interventionFor(args.results);
  if (intervention) {
    return {
      action: "stop",
      reason: intervention.message,
      intervention,
    };
  }

  const { blocking, advisory } = defectsFromResults(args.results);
  const p0Blocked = args.results.some((r) => r.priority === "P0" && r.status === "blocked");

  if (!blocking.length && !p0Blocked) return { action: "accept" };

  if (args.attemptsUsed >= MAX_REPAIR_ATTEMPTS) {
    return {
      action: "stop",
      reason: `Tried ${MAX_REPAIR_ATTEMPTS} times and the same problem came back.`,
    };
  }

  const fingerprint = fingerprintDefects(blocking);
  if (args.previousFingerprint && args.previousFingerprint === fingerprint) {
    // Same failure, unchanged, after a fix attempt. Another identical round
    // spends budget to learn nothing.
    return {
      action: "stop",
      reason: "The same problem came back unchanged after a fix, so retrying would not help.",
    };
  }

  return { action: "repair", attempt: args.attemptsUsed + 1, blocking, advisory };
}

/** Stable signature of a failure set — used to detect a stuck loop. */
export function fingerprintDefects(defects: string[]): string {
  return [...defects]
    .map((d) => d.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim())
    .sort()
    .join("|")
    .slice(0, 800);
}
