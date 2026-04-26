/**
 * Pure helpers for the human-readable activity feed shown while Petal
 * generates and deploys an app. No React, no side effects — just data.
 *
 * The user never sees any technical jargon: no "tool call", "Cloudflare",
 * "Railway", "esbuild", "SSE", etc. Each phase has a friendly emoji,
 * a one-line action, and an optional reassurance line if it runs long.
 */

export type PhaseId = "thinking" | "designing" | "writing" | "polishing" | "deploying" | "live";

export type PhaseStatus = "pending" | "active" | "done" | "failed";

export type Phase = {
  id: PhaseId;
  emoji: string;
  /** Default headline shown when the phase is pending or active. */
  label: string;
  /** Shown after ~10s of inactivity to reassure the user. */
  reassurance?: string;
  /** Headline shown after the phase completes successfully. */
  doneLabel: string;
  status: PhaseStatus;
  /** ms timestamp when the phase became active. */
  startedAt?: number;
  /** ms timestamp when the phase finished (done or failed). */
  endedAt?: number;
};

export const ORDERED_PHASE_IDS: PhaseId[] = [
  "thinking",
  "designing",
  "writing",
  "polishing",
  "deploying",
  "live",
];

export function defaultPhases(): Phase[] {
  return ORDERED_PHASE_IDS.map((id) => ({
    ...PHASE_TEMPLATES[id],
    id,
    status: "pending" as PhaseStatus,
  }));
}

const PHASE_TEMPLATES: Record<PhaseId, Omit<Phase, "id" | "status">> = {
  thinking: {
    emoji: "🌸",
    label: "Reading your request…",
    doneLabel: "Got it",
    reassurance: "Petal is thinking about the best way to build this.",
  },
  designing: {
    emoji: "✨",
    label: "Designing your app…",
    doneLabel: "Design ready",
    reassurance: "Sketching out the layout and features.",
  },
  writing: {
    emoji: "📝",
    label: "Writing your app…",
    doneLabel: "Files ready",
    reassurance: "Crafting each screen carefully.",
  },
  polishing: {
    emoji: "🎨",
    label: "Adding finishing touches…",
    doneLabel: "Polished",
    reassurance: "Almost done with the code.",
  },
  deploying: {
    emoji: "🚀",
    label: "Putting your app online…",
    doneLabel: "Deployed",
    reassurance: "This usually takes 30–90 seconds.",
  },
  live: {
    emoji: "🌟",
    label: "Your app is live!",
    doneLabel: "Your app is live!",
  },
};

/** Return a copy of `phases` with `nextActive` set to active. Marks every
 *  earlier phase as done, leaves later phases pending. Idempotent. */
export function advanceTo(phases: Phase[], nextActive: PhaseId, now = Date.now()): Phase[] {
  const targetIdx = ORDERED_PHASE_IDS.indexOf(nextActive);
  if (targetIdx < 0) return phases;
  return phases.map((p, i) => {
    if (i < targetIdx) {
      // Earlier phases — mark done if not already.
      if (p.status === "done" || p.status === "failed") return p;
      return { ...p, status: "done", endedAt: p.endedAt ?? now };
    }
    if (i === targetIdx) {
      if (p.status === "active") return p; // already active, keep startedAt
      return { ...p, status: "active", startedAt: p.startedAt ?? now };
    }
    return p;
  });
}

/** Mark all phases up to and including `lastDone` as done. */
export function completeThrough(phases: Phase[], lastDone: PhaseId, now = Date.now()): Phase[] {
  const targetIdx = ORDERED_PHASE_IDS.indexOf(lastDone);
  if (targetIdx < 0) return phases;
  return phases.map((p, i) => {
    if (i <= targetIdx) {
      if (p.status === "done" || p.status === "failed") return p;
      return { ...p, status: "done", endedAt: p.endedAt ?? now };
    }
    return p;
  });
}

/** Mark the currently-active (or named) phase as failed. */
export function markFailed(phases: Phase[], failedId?: PhaseId, now = Date.now()): Phase[] {
  return phases.map((p) => {
    const isTarget = failedId ? p.id === failedId : p.status === "active";
    if (!isTarget) return p;
    return { ...p, status: "failed", endedAt: p.endedAt ?? now };
  });
}

/** Total elapsed wall-clock time across the whole flow, in seconds. */
export function totalElapsedSeconds(phases: Phase[]): number {
  const starts = phases.map((p) => p.startedAt).filter((t): t is number => typeof t === "number");
  const ends = phases.map((p) => p.endedAt).filter((t): t is number => typeof t === "number");
  if (starts.length === 0) return 0;
  const first = Math.min(...starts);
  const last = ends.length ? Math.max(...ends) : Date.now();
  return Math.max(0, Math.round((last - first) / 1000));
}
