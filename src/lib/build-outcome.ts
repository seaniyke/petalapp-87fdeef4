/**
 * The ONE decision for how an incoming builder callback may change a build.
 *
 * Invariant: once a build (or another build of the same code revision) has
 * reached authoritative success, nothing that arrives later can downgrade it
 * or trigger a refund. Stale, duplicate and out-of-order callbacks are
 * recorded at most as history. Refunds only happen when the customer did not
 * receive the paid outcome.
 *
 * The database `refund_build_charge` enforces the same refund rule, so this
 * holds even if a caller forgets to consult this function.
 */
export type BuildStatus = "pending" | "building" | "ready" | "failed" | string;

export type FailureClass =
  | "source" // the code didn't compile / build
  | "deployment" // it built but never went live
  | "verification" // it went live; a browser expectation failed
  | "infrastructure" // timeout / transport problem on our side
  | "stale"; // result for an older revision

export type OutcomeInput = {
  existingStatus: BuildStatus;
  incoming: "ready" | "failed";
  buildRevision: number | null;
  projectRevision: number | null;
  /** Another build of the same revision is already ready. */
  siblingReadyForRevision: boolean;
  /** The builder says the site was deployed (URL live) despite failing. */
  deployed?: boolean;
  errorMessage?: string;
};

export type OutcomeDecision = {
  /** Apply the incoming status to the build row. */
  apply: boolean;
  /** May the customer's charge be refunded because of this callback? */
  refundAllowed: boolean;
  /** May this callback change project readiness / current build pointer? */
  affectsReadiness: boolean;
  failureClass: FailureClass | null;
  reason: string;
};

const INFRA_RX = /\b(timed? ?out|timeout|ECONNRESET|ETIMEDOUT|socket hang up|callback (delivery )?failed|502|503|504|fetch failed)\b/i;

export function classifyFailure(input: Pick<OutcomeInput, "deployed" | "errorMessage">): FailureClass {
  const msg = input.errorMessage ?? "";
  if (input.deployed) return INFRA_RX.test(msg) ? "infrastructure" : "verification";
  if (INFRA_RX.test(msg)) return "infrastructure";
  if (/deploy/i.test(msg)) return "deployment";
  return "source";
}

export function decideBuildOutcome(i: OutcomeInput): OutcomeDecision {
  const stale =
    i.buildRevision != null && i.projectRevision != null && i.buildRevision < i.projectRevision;

  // Terminal success wins; duplicates of any terminal state are no-ops.
  if (i.existingStatus === "ready") {
    return {
      apply: false,
      refundAllowed: false,
      affectsReadiness: false,
      failureClass: i.incoming === "failed" ? "stale" : null,
      reason: i.incoming === "ready" ? "duplicate ready" : "late failure after ready",
    };
  }
  if (i.existingStatus === "failed" && i.incoming === "failed") {
    return { apply: false, refundAllowed: false, affectsReadiness: false, failureClass: null, reason: "duplicate failed" };
  }

  if (stale) {
    return {
      apply: true,
      refundAllowed: false,
      affectsReadiness: false,
      failureClass: i.incoming === "failed" ? "stale" : null,
      reason: "stale revision",
    };
  }

  if (i.incoming === "ready") {
    // FAILED → later SUCCESS is allowed: the customer did get the outcome.
    return { apply: true, refundAllowed: false, affectsReadiness: true, failureClass: null, reason: "ready" };
  }

  const failureClass = classifyFailure(i);
  if (i.siblingReadyForRevision) {
    return { apply: true, refundAllowed: false, affectsReadiness: false, failureClass, reason: "revision already delivered" };
  }
  // A live site with a failed browser expectation or a post-deploy timeout
  // is not a customer-outcome failure on its own.
  const delivered = failureClass === "verification" || (failureClass === "infrastructure" && !!i.deployed);
  return {
    apply: true,
    refundAllowed: !delivered,
    affectsReadiness: true,
    failureClass,
    reason: delivered ? "delivered; verification/infra only" : "not delivered",
  };
}
