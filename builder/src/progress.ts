/**
 * Progress heartbeats — "never cut a run that is still working".
 *
 * Every long stage used to be wrapped in a wall-clock timeout: 22 minutes for
 * a whole job, 8 for verification, 4 for npm install. Those clocks exist to
 * stop a *wedged* process from leaking a slot forever, but they cannot tell
 * the difference between wedged and slow — so a big project that was actively
 * installing, compiling, or being browsed got killed mid-flight.
 *
 * The replacement rule: a stage runs for as long as it keeps producing
 * progress. Each stage calls `beat()` whenever something real happens (a line
 * of child-process output, a route visited, a file written). The watchdog only
 * fires after a *quiet period* with no beats at all, which is the actual
 * "this thing is hung" signal.
 *
 * Deliberately in-process and dependency-free: the heartbeat is also read by
 * the callback payload so the app can surface "still working — <label>".
 */

export interface HeartbeatSnapshot {
  /** Epoch ms of the most recent beat. */
  at: number;
  /** Short human line describing what is happening right now. */
  label: string;
  /** Total beats since the heartbeat was created. */
  beats: number;
}

export class Heartbeat {
  private lastAt = Date.now();
  private currentLabel: string;
  private count = 0;
  private readonly listeners = new Set<(s: HeartbeatSnapshot) => void>();

  constructor(label = "starting") {
    this.currentLabel = label;
  }

  /** Record progress. Cheap enough to call per output chunk. */
  beat(label?: string): void {
    this.lastAt = Date.now();
    this.count++;
    if (label) this.currentLabel = label;
    if (this.listeners.size > 0) {
      const snap = this.snapshot();
      for (const fn of this.listeners) {
        try {
          fn(snap);
        } catch {
          /* a listener must never be able to fail the build */
        }
      }
    }
  }

  onBeat(fn: (s: HeartbeatSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Milliseconds since the last sign of life. */
  quietFor(): number {
    return Date.now() - this.lastAt;
  }

  snapshot(): HeartbeatSnapshot {
    return { at: this.lastAt, label: this.currentLabel, beats: this.count };
  }
}

export class InactivityError extends Error {
  constructor(label: string, quietMs: number) {
    super(
      `No progress for ${Math.round(quietMs / 1000)}s — last activity: ${label}`,
    );
    this.name = "InactivityError";
  }
}

/**
 * Resolve `p` however long it takes, as long as `hb` keeps beating.
 *
 * Rejects with `InactivityError` only once the heartbeat has been silent for
 * `quietMs`. There is no upper bound on total duration by design.
 */
export function withInactivity<T>(
  p: Promise<T>,
  quietMs: number,
  hb: Heartbeat,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    // Check at a fraction of the quiet window so the reported silence is
    // close to the real one without polling hot.
    const tick = Math.max(1_000, Math.min(15_000, Math.floor(quietMs / 10)));
    const timer = setInterval(() => {
      if (done) return;
      const quiet = hb.quietFor();
      if (quiet >= quietMs) {
        done = true;
        clearInterval(timer);
        reject(new InactivityError(hb.snapshot().label, quiet));
      }
    }, tick);
    p.then(
      (v) => {
        done = true;
        clearInterval(timer);
        resolve(v);
      },
      (e) => {
        done = true;
        clearInterval(timer);
        reject(e);
      },
    );
  });
}
