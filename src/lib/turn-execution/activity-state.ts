/**
 * ONE interpretation of "is this turn still active?" for every surface.
 *
 * Local flags (busy, deploying, awaiting build, silent resume) only say the
 * client is still observing. Once the authoritative lifecycle reaches a
 * terminal state, it wins — no flag can keep a spinner alive after that.
 */
import { isTerminal, type Lifecycle } from "@/lib/turn-execution/turn-reducer";

export interface LocalActivityFlags {
  busy?: boolean;
  isDeploying?: boolean;
  awaitingBuild?: boolean;
  awaitingSilentResume?: boolean;
}

const SUCCESS_BLOCKERS: ReadonlySet<string> = new Set([
  "failed",
  "cancelled",
  "stopping",
  "build_failed",
  "verify_failed",
  "running",
  "generated",
  "building",
]);

export function deriveActivityState(
  lifecycle: Lifecycle | string | null | undefined,
  flags: LocalActivityFlags,
  completeHint = false,
): { active: boolean; complete: boolean } {
  const local = !!(flags.busy || flags.isDeploying || flags.awaitingBuild || flags.awaitingSilentResume);
  if (!lifecycle || lifecycle === "idle") return { active: local, complete: completeHint && !local };
  if (lifecycle === "stopping") return { active: true, complete: false };
  if (isTerminal(lifecycle as Lifecycle)) {
    return { active: false, complete: completeHint && !SUCCESS_BLOCKERS.has(lifecycle) };
  }
  // Non-terminal authoritative lifecycle (running/generated/building) is active by itself.
  return { active: true, complete: false };
}
