/**
 * Phase 6 — the readiness verdict.
 *
 * "Ready" used to mean the build compiled and nothing blocking showed up in
 * the browser check. That is a claim about the build, not about the app. This
 * module turns the evidence the Test Lab already collects into an explicit
 * verdict, and keeps three answers apart that must never be collapsed:
 *
 *   ready      — proven: must-work checks ran and passed.
 *   not_ready  — something must-work failed and we know what.
 *   unverified — we could not actually check. Never a pass.
 *
 * Pure by design: no IO, no model calls. The caller records the result.
 */
import type { CaseResult } from "@/server/test-results.server";
import type { Intervention } from "@/server/test-repair.server";

export type ReadinessVerdict = "ready" | "not_ready" | "unverified";

export interface Readiness {
  verdict: ReadinessVerdict;
  /** Plain-language lines for the person. No jargon, no file paths. */
  reasons: string[];
  /** Titles of must-work checks that passed. */
  checked: string[];
  /** Titles of must-work checks that failed. */
  failed: string[];
  /** Titles of must-work checks that could not be run. */
  unverified: string[];
  /** True only when the verdict is `ready`. Drives the accept decision. */
  accepted: boolean;
}

const MAX_LIST = 12;

const titles = (results: CaseResult[]) => results.map((r) => r.title).slice(0, MAX_LIST);

export function evaluateReadiness(args: {
  /** The build shipped and the live address served the real app. */
  shipped: boolean;
  /** Blocking runtime faults from the existing browser check. */
  blockingDefects: string[];
  /** Test Lab results for this build. Absent when no run happened. */
  results?: CaseResult[] | null;
  /** The repair budget is spent — no more automatic attempts. */
  budgetSpent?: boolean;
  /** Something no code fix can resolve stopped the run. */
  intervention?: Intervention | null;
}): Readiness {
  const base: Readiness = {
    verdict: "not_ready",
    reasons: [],
    checked: [],
    failed: [],
    unverified: [],
    accepted: false,
  };

  if (!args.shipped) {
    return {
      ...base,
      verdict: "not_ready",
      reasons: ["The app did not finish building, so there was nothing to check."],
    };
  }

  if (args.blockingDefects.length > 0) {
    return {
      ...base,
      verdict: "not_ready",
      reasons: [
        "Kimble opened the app and hit a fault that stops it working.",
        ...args.blockingDefects.slice(0, 8),
      ],
    };
  }

  // Something unfixable stopped the checks. The build may be fine; we simply
  // have no proof, and saying "ready" here would be a guess.
  if (args.intervention) {
    return {
      ...base,
      verdict: "unverified",
      reasons: [args.intervention.message, "Kimble could not finish checking the app."],
    };
  }

  const results = args.results ?? [];

  // No Test Lab run for this build — fall back to exactly today's decision so
  // nothing regresses for builds that never reach the new path.
  if (results.length === 0) {
    return {
      ...base,
      verdict: "ready",
      accepted: true,
      reasons: ["The app built and opened with no faults."],
    };
  }

  const mustWork = results.filter((r) => r.priority === "P0");
  const passed = mustWork.filter((r) => r.status === "passed");
  const failed = mustWork.filter((r) => r.status === "failed");
  const notRun = mustWork.filter((r) => r.status === "blocked" || r.status === "skipped");

  if (failed.length > 0) {
    return {
      ...base,
      verdict: "not_ready",
      checked: titles(passed),
      failed: titles(failed),
      unverified: titles(notRun),
      reasons: [
        args.budgetSpent
          ? "Kimble tried to fix this and the problem is still there."
          : "Something important in the app is not working yet.",
        ...failed
          .slice(0, 6)
          .map((r) => `${r.title}${r.url ? ` (on ${r.url})` : ""} — ${r.reason ?? "did not work"}`),
      ],
    };
  }

  if (notRun.length > 0) {
    return {
      ...base,
      verdict: "unverified",
      checked: titles(passed),
      unverified: titles(notRun),
      reasons: [
        "Kimble could not check everything that has to work, so it is not calling the app ready.",
        ...notRun.slice(0, 6).map((r) => `${r.title} — ${r.reason ?? "could not be tested"}`),
      ],
    };
  }

  if (passed.length === 0) {
    return {
      ...base,
      verdict: "unverified",
      reasons: ["No must-work check ran, so there is nothing proving the app works."],
    };
  }

  return {
    ...base,
    verdict: "ready",
    accepted: true,
    checked: titles(passed),
    reasons: ["Kimble opened the app and confirmed the important things work."],
  };
}

/** One short line for the build card. */
export function readinessHeadline(readiness: Readiness): string {
  switch (readiness.verdict) {
    case "ready":
      return "Your app is ready — Kimble checked it.";
    case "not_ready":
      return "Your app is not ready yet.";
    default:
      return "Kimble could not finish checking your app.";
  }
}
