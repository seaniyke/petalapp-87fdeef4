/**
 * Drain mode for safe deploys.
 *
 * The VPS deploy script (deploy/builder/petal-builder-deploy) creates
 * DRAIN_FILE inside the running container with `docker exec … touch`. While it
 * exists the builder refuses NEW jobs (/build, /agent/generate) with a
 * retryable 503, so the app holds them and re-sends them to whichever builder
 * answers next. Work already accepted — and the /exec and /browse calls that
 * work makes — keeps running untouched.
 *
 * Why a file and not an HTTP endpoint: only root on the VPS (or the docker
 * group) can create it, so it needs no secret and no new public surface. It
 * lives in the container's own filesystem (not the /tmp workspace volume), so
 * a freshly created container never starts drained.
 *
 * Self-healing: a drain file older than DRAIN_MAX_AGE_MS is ignored, and every
 * builder start deletes it. A deploy script killed half-way can therefore never
 * leave the builder refusing work for long.
 */
import { rmSync, statSync } from "node:fs";

export const DRAIN_FILE = process.env.DRAIN_FILE ?? "/app/.petal-drain";
export const DRAIN_MAX_AGE_MS = Number(process.env.DRAIN_MAX_AGE_MS ?? 10 * 60 * 1000);
/** Seconds the app is told to wait before re-sending a refused job. */
export const DRAIN_RETRY_AFTER_S = 5;

type StatFn = (path: string) => { mtimeMs: number };

export class DrainGate {
  private shuttingDown = false;

  constructor(
    private readonly file: string = DRAIN_FILE,
    private readonly maxAgeMs: number = DRAIN_MAX_AGE_MS,
    private readonly stat: StatFn = statSync,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while new jobs must be refused (deploy drain or shutdown). */
  isDraining(): boolean {
    if (this.shuttingDown) return true;
    try {
      const { mtimeMs } = this.stat(this.file);
      return this.now() - mtimeMs < this.maxAgeMs;
    } catch {
      return false; // no file → serving normally
    }
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  beginShutdown(): void {
    this.shuttingDown = true;
  }

  /** A builder that just started is never drained. */
  clearStale(rm: (p: string, o: { force: boolean }) => void = rmSync): void {
    try {
      rm(this.file, { force: true });
    } catch {
      /* read-only fs or similar: the age limit still self-heals */
    }
  }
}

/**
 * Ids of jobs accepted and not yet finished. A re-sent request for a job that
 * is already queued or running is acknowledged without starting it twice, so
 * the app can safely retry when a response was lost.
 */
export class AcceptedJobs {
  private readonly ids = new Set<string>();
  /** False when this id is already queued or running. */
  begin(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    return true;
  }
  end(id: string): void {
    this.ids.delete(id);
  }
  has(id: string): boolean {
    return this.ids.has(id);
  }
  get size(): number {
    return this.ids.size;
  }
}

/**
 * Wait until `busy()` reports zero, up to `graceMs`. True when idle was
 * reached. Used on SIGTERM so an idle builder exits at once instead of being
 * killed after Docker's stop timeout.
 */
export async function waitUntilIdle(
  busy: () => number,
  graceMs: number,
  pollMs = 250,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): Promise<boolean> {
  const deadline = now() + graceMs;
  for (;;) {
    if (busy() === 0) return true;
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
}
