/**
 * Mobile build orchestration — Codemagic provider.
 *
 * Tier 2 — wraps the web app as a native shell using Capacitor (hidden
 * from users) and offloads .ipa / .aab builds to Codemagic so Petal
 * doesn't need to own a Mac fleet.
 *
 * Auth: Codemagic REST API uses a personal/team API token in the
 *   `x-auth-token` header. Read from process.env.CODEMAGIC_API_TOKEN.
 *
 * Pricing model (matches Cloud + AI metering):
 *  - Pass-through per build, deducted from the runtime wallet.
 *  - Estimated ~$0.20 unsigned / ~$0.40 signed avg.
 *  - Free tier: gated entirely. Paid-plan-only, like backend/email/domain.
 *
 * Status mapping: Codemagic build statuses are normalized into our
 * 4-state machine (queued | running | succeeded | failed).
 */

const CODEMAGIC_API = "https://api.codemagic.io";

export type MobilePlatform = "ios" | "android";

export type MobileBuildKind = "unsigned" | "signed";

export interface MobileBuildRequest {
  projectId: string;
  platform: MobilePlatform;
  kind: MobileBuildKind;
  /** Reverse-DNS bundle id, e.g. com.acme.todoapp */
  bundleId: string;
  /** Codemagic appId — created once per Petal project, persisted in mobile_apps. */
  codemagicAppId: string;
  /** Workflow id defined in the codemagic.yaml of the petal-mobile-shell template. */
  workflowId: string;
  /** Branch to build from. Defaults to `main`. */
  branch?: string;
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

export const ESTIMATED_BUILD_COST_USD: Record<MobileBuildKind, number> = {
  unsigned: 0.20,
  signed: 0.40,
};

function getToken(): string {
  const token = process.env.CODEMAGIC_API_TOKEN;
  if (!token) {
    throw new Error("CODEMAGIC_API_TOKEN is not configured");
  }
  return token;
}

/** Map Codemagic raw status → our normalized 4-state machine. */
function normalizeStatus(raw: string | undefined): MobileBuildResult["status"] {
  switch (raw) {
    case "queued":
    case "preparing":
    case "fetching":
      return "queued";
    case "building":
    case "testing":
    case "publishing":
    case "finishing":
      return "running";
    case "finished":
    case "successful":
      return "succeeded";
    case "failed":
    case "canceled":
    case "skipped":
    case "timeout":
      return "failed";
    default:
      return "queued";
  }
}

async function codemagicFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${CODEMAGIC_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-auth-token": getToken(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Codemagic ${path} failed [${res.status}]: ${body}`);
  }
  return res;
}

export const codemagicProvider: BuildProvider = {
  name: "codemagic",

  async startBuild(req) {
    const res = await codemagicFetch("/builds", {
      method: "POST",
      body: JSON.stringify({
        appId: req.codemagicAppId,
        workflowId: req.workflowId,
        branch: req.branch ?? "main",
        environment: {
          variables: {
            PETAL_PROJECT_ID: req.projectId,
            PETAL_BUNDLE_ID: req.bundleId,
            PETAL_PLATFORM: req.platform,
            PETAL_BUILD_KIND: req.kind,
          },
        },
      }),
    });
    const data = (await res.json()) as { buildId?: string; _id?: string };
    const id = data.buildId ?? data._id ?? "";
    return {
      id,
      status: "queued",
      estimatedCostUsd: ESTIMATED_BUILD_COST_USD[req.kind],
    };
  },

  async getBuild(id) {
    const res = await codemagicFetch(`/builds/${id}`);
    const data = (await res.json()) as {
      build?: {
        status?: string;
        artefacts?: Array<{ url?: string; name?: string }>;
      };
    };
    const build = data.build ?? {};
    // Prefer .ipa / .aab / .apk over arbitrary artefacts.
    const preferred = build.artefacts?.find((a) =>
      /\.(ipa|aab|apk)$/i.test(a.name ?? ""),
    );
    return {
      id,
      status: normalizeStatus(build.status),
      artifactUrl: preferred?.url ?? build.artefacts?.[0]?.url,
      estimatedCostUsd: 0,
    };
  },
};
