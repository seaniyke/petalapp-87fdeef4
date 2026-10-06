import { deriveActivityState, type LocalActivityFlags } from "@/lib/turn-execution/activity-state";
import type { Stage } from "@/lib/turn-execution/turn-reducer";
import type { PhaseId } from "@/lib/build-phases";

export function robotActivity(lifecycle: string, stage: Stage, flags: LocalActivityFlags) {
  const phaseId: PhaseId = ["planning"].includes(stage)
    ? "designing"
    : ["generating", "writing", "repairing"].includes(stage)
      ? "writing"
      : ["validating", "verifying"].includes(stage)
        ? "polishing"
        : stage === "building"
          ? "deploying"
          : ["ready", "published"].includes(stage)
            ? "live"
            : "thinking";
  const failed = ["failed", "build_failed", "verify_failed"].includes(lifecycle);
  const active = deriveActivityState(lifecycle, flags).active && lifecycle !== "stopping";
  return { phaseId, active, failed };
}
