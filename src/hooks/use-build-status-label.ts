/**
 * F2 — the single source of truth for build status wording.
 *
 * Before this hook the same build could be called "Publishing…" in the header,
 * "Publishing" in the PublishSheet pill, "Deploying" in the activity card and
 * "pending" in the raw row — four names for one fact. Every surface now reads
 * from `resolveBuildStatus`, so changing a word changes it everywhere.
 *
 * Roadmap: F2 (unlocks H1, M8). Design Bible §10 — one status, one wording.
 */
import { useMemo } from "react";

export type BuildStatusState =
  | "unpublished"
  | "generating"
  | "queued"
  | "building"
  | "deploying"
  | "live"
  | "update_available"
  | "failed";

export type BuildStatusTone = "neutral" | "progress" | "success" | "warning" | "danger";

export type BuildStatusInput = {
  /** Raw build row status: pending · building · ready · failed. */
  buildStatus?: string | null;
  /** True while the model is still generating code (before a build exists). */
  isGenerating?: boolean;
  /** True while a publish request is in flight from this client. */
  publishing?: boolean;
  /** True when the project has at least one successfully published build. */
  hasPublishedBuild?: boolean;
  /** True when the latest build is newer than the published one. */
  updateAvailable?: boolean;
  /** Seconds spent in the current busy state, for the M8 elapsed timer. */
  elapsedSec?: number | null;
};

export type BuildStatus = {
  state: BuildStatusState;
  /** Describes what is true right now — pills, headings, badges. */
  statusLabel: string;
  /** Describes what tapping does — buttons only. */
  ctaLabel: string;
  tone: BuildStatusTone;
  /** True while work is in flight; drives spinners and disabled CTAs. */
  isBusy: boolean;
  /**
   * M8 — only present once a busy state has run past 30s. Below that a timer
   * is noise; above it, silence reads as "stuck".
   */
  elapsedLabel: string | null;
};

/** 45 -> "0:45", 132 -> "2:12". */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Show the elapsed clock only once the wait stops feeling instant. */
export const ELAPSED_VISIBLE_AFTER_SEC = 30;

export function resolveBuildStatus(input: BuildStatusInput): BuildStatus {
  const {
    buildStatus,
    isGenerating = false,
    publishing = false,
    hasPublishedBuild = false,
    updateAvailable = false,
    elapsedSec = null,
  } = input;

  const state: BuildStatusState = (() => {
    if (isGenerating) return "generating";
    if (publishing) return "deploying";
    if (buildStatus === "failed") return "failed";
    if (buildStatus === "pending") return "queued";
    if (buildStatus === "building") return "building";
    if (updateAvailable) return "update_available";
    if (hasPublishedBuild && buildStatus === "ready") return "live";
    return "unpublished";
  })();

  const spec: Record<BuildStatusState, Omit<BuildStatus, "state" | "elapsedLabel">> = {
    unpublished: {
      statusLabel: "Not published yet",
      ctaLabel: "Publish",
      tone: "neutral",
      isBusy: false,
    },
    generating: {
      statusLabel: "Building your app…",
      ctaLabel: "Building…",
      tone: "progress",
      isBusy: true,
    },
    queued: { statusLabel: "Queued…", ctaLabel: "Publishing…", tone: "progress", isBusy: true },
    building: {
      statusLabel: "Building…",
      ctaLabel: "Publishing…",
      tone: "progress",
      isBusy: true,
    },
    deploying: {
      statusLabel: hasPublishedBuild ? "Publishing update…" : "Publishing…",
      ctaLabel: hasPublishedBuild ? "Publishing update…" : "Publishing…",
      tone: "progress",
      isBusy: true,
    },
    live: { statusLabel: "Published", ctaLabel: "Published", tone: "success", isBusy: false },
    update_available: {
      statusLabel: "Update available",
      ctaLabel: "Update",
      tone: "warning",
      isBusy: false,
    },
    failed: {
      statusLabel: "Publish failed",
      ctaLabel: "Retry publish",
      tone: "danger",
      isBusy: false,
    },
  };

  const base = spec[state];
  const elapsedLabel =
    base.isBusy && typeof elapsedSec === "number" && elapsedSec >= ELAPSED_VISIBLE_AFTER_SEC
      ? formatElapsed(elapsedSec)
      : null;

  return { state, ...base, elapsedLabel };
}

export function useBuildStatusLabel(input: BuildStatusInput): BuildStatus {
  const {
    buildStatus,
    isGenerating,
    publishing,
    hasPublishedBuild,
    updateAvailable,
    elapsedSec,
  } = input;
  return useMemo(
    () =>
      resolveBuildStatus({
        buildStatus,
        isGenerating,
        publishing,
        hasPublishedBuild,
        updateAvailable,
        elapsedSec,
      }),
    [buildStatus, isGenerating, publishing, hasPublishedBuild, updateAvailable, elapsedSec],
  );
}
