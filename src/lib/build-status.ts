/**
 * THE authoritative build state machine.
 *
 *   generated → validated → built → browser verified → ready → published
 *
 * A build row may only become "ready" through `decideBuildStatus`. Every
 * earlier stage being done (generation, files written, build succeeded) is
 * NOT ready on its own. Publishing requires "ready" (see api/publish.ts).
 */
export type BuildStage = "generated" | "validated" | "built" | "browser_verified" | "ready" | "published";

export interface BuildEvidence {
  /** The builder reported the bundle built and uploaded. */
  built: boolean;
  /** Kimble's own probe fetched the deployed URL and got a real app. */
  deployProbeOk: boolean;
  /** Browser check findings judged blocking (after removing verifier noise). */
  blockingDefects: string[];
  /** Every blocking finding is CDN-propagation noise the probe disproved. */
  blockingIsEdgeNoiseOnly: boolean;
  /** Saved files still contain an import-resolver stand-in (incomplete app). */
  hasPlaceholderFiles: boolean;
}

export type BuildDecision =
  | { status: "ready"; stage: "ready" }
  | { status: "failed"; stage: Exclude<BuildStage, "ready" | "published">; reason: string };

export function decideBuildStatus(e: BuildEvidence): BuildDecision {
  if (!e.built) return { status: "failed", stage: "validated", reason: "build failed" };
  if (e.hasPlaceholderFiles) return { status: "failed", stage: "built", reason: "incomplete generation" };
  if (!e.deployProbeOk) return { status: "failed", stage: "built", reason: "deploy probe failed" };
  if (e.blockingDefects.length > 0 && !e.blockingIsEdgeNoiseOnly) {
    return { status: "failed", stage: "built", reason: "browser check found a runtime failure" };
  }
  return { status: "ready", stage: "ready" };
}

/** Publishing is allowed only from "ready"; a failed publish leaves the build
 *  ready (still publishable) but never "published". */
export function publishOutcome(buildStatus: string, publishOk: boolean): "published" | "ready" | "not_publishable" {
  if (buildStatus !== "ready") return "not_publishable";
  return publishOk ? "published" : "ready";
}
