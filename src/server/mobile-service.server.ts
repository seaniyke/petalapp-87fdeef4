/**
 * Mobile build orchestration (stub).
 *
 * Tier 2 — wraps the web app as a native shell using Capacitor (hidden
 * from users) and offloads .ipa / .aab builds to a remote runner.
 *
 * Provider: Codemagic. Picked because it's the most battle-tested API
 * for Capacitor → iOS/Android, supports unsigned + signed builds, and
 * doesn't require Petal to own a Mac fleet. Swappable later via the
 * BuildProvider interface below.
 *
 * Pricing model (matches Cloud + AI metering):
 *  - Pass-through per build, deducted from the runtime wallet.
 *  - Estimated ~$0.30/build avg (Codemagic M1 minutes ≈ $0.038/min).
 *  - Free tier: gated entirely. Paid-plan-only, like backend/email/domain.
 *
 * NOTE: this file is intentionally stub-only for the scaffolding pass.
 * Real Codemagic API calls land in a follow-up once the UI flow + the
 * `mobile_apps` table migration are approved.
 */

export type MobilePlatform = "ios" | "android";

export type MobileBuildKind = "unsigned" | "signed";

export interface MobileBuildRequest {
  projectId: string;
  platform: MobilePlatform;
  kind: MobileBuildKind;
  /** Reverse-DNS bundle id, e.g. com.acme.todoapp */
  bundleId: string;
}

export interface MobileBuildResult {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  artifactUrl?: string;
  estimatedCostUsd: number;
}

export interface BuildProvider {
  name: "codemagic";
  startBuild(req: MobileBuildRequest): Promise<MobileBuildResult>;
  getBuild(id: string): Promise<MobileBuildResult>;
}

/**
 * Default per-build cost estimate in USD. Used for preflight UI + wallet
 * pre-auth before the build is actually queued. Tune once real builds run.
 */
export const ESTIMATED_BUILD_COST_USD: Record<MobileBuildKind, number> = {
  unsigned: 0.20,
  signed: 0.40,
};

/**
 * Stub — to be replaced with a real fetch() against the Codemagic REST
 * API in the follow-up pass. Keeping the interface stable now so the UI
 * + dynamic prompt can land without waiting on credentials.
 */
export const codemagicProvider: BuildProvider = {
  name: "codemagic",
  async startBuild(req) {
    return {
      id: `stub-${req.platform}-${Date.now()}`,
      status: "queued",
      estimatedCostUsd: ESTIMATED_BUILD_COST_USD[req.kind],
    };
  },
  async getBuild(id) {
    return { id, status: "queued", estimatedCostUsd: 0 };
  },
};
