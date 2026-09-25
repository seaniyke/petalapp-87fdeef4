/**
 * Worker liveness + ownership for a durable turn.
 *
 * The worker that runs a turn claims a lease and checks in on a fixed
 * interval, independent of whether it is producing events (a long AI call
 * is quiet but alive). The database sweeper marks a turn whose worker
 * stopped checking in as worker_lost. If the lease belongs to another worker
 * ("lost") or the turn already ended ("terminal" — e.g. Stop), this worker
 * stops its own run immediately: a stale worker can never keep writing.
 */
export type BeatState = "ok" | "lost" | "terminal";

export const HEARTBEAT_INTERVAL_MS = 20_000;

export function startHeartbeat(args: {
  turnId: string;
  lease: string;
  beat: (turnId: string, lease: string) => Promise<BeatState>;
  onLost: (state: Exclude<BeatState, "ok">) => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): { stop: () => void; tick: () => Promise<BeatState> } {
  const si = args.setIntervalFn ?? setInterval;
  const ci = args.clearIntervalFn ?? clearInterval;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    stopped = true;
    if (timer) ci(timer);
    timer = null;
  };
  const tick = async (): Promise<BeatState> => {
    if (stopped) return "ok";
    let state: BeatState = "ok";
    try {
      state = await args.beat(args.turnId, args.lease);
    } catch {
      state = "ok"; // a missed beat is not proof of loss
    }
    if (state !== "ok" && !stopped) {
      stop();
      args.onLost(state);
    }
    return state;
  };
  void tick();
  timer = si(() => void tick(), args.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();
  return { stop, tick };
}
