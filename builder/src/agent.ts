/**
 * Durable agent jobs.
 *
 * The builder owns the connection to the app's generation pipeline so a
 * browser refresh, closed tab or dropped network can never kill a build. It
 * calls `/api/generate` as the internal caller (shared secret + user id),
 * attached to the turn row the app already opened, and simply drains the
 * stream until the run ends. The pipeline records every event to the turn
 * log itself; the browser reads that log.
 */
import { z } from "zod";

export const AgentJobSchema = z.object({
  turnId: z.string().uuid(),
  userId: z.string().uuid(),
  body: z.record(z.unknown()),
  headers: z.record(z.string()),
  appOrigin: z.string().url(),
});
export type AgentJob = z.infer<typeof AgentJobSchema>;

const FORWARDABLE = new Set(["authorization", "x-petal-target", "x-kimble-inference-eval"]);

/** Exact request the builder sends into the app for a job. */
export function internalGenerateRequest(job: AgentJob, secret: string): { url: string; init: RequestInit } {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-petal-internal-secret": secret,
    "x-petal-internal-user": job.userId,
    "x-petal-durable-turn": job.turnId,
  };
  for (const [k, v] of Object.entries(job.headers)) {
    if (FORWARDABLE.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  }
  return {
    url: new URL("/api/generate", job.appOrigin).toString(),
    init: { method: "POST", headers, body: JSON.stringify({ ...job.body, turnId: job.turnId }) },
  };
}

/** Small semaphore + bounded queue. Full queue is the only refusal. */
export class AgentPool {
  private inFlight = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly max: number, private readonly maxQueue: number) {}
  tryEnqueue(run: () => Promise<void>): boolean {
    if (this.inFlight >= this.max && this.waiting.length >= this.maxQueue) return false;
    const start = () => {
      this.inFlight++;
      void run().finally(() => {
        this.inFlight--;
        this.waiting.shift()?.();
      });
    };
    if (this.inFlight < this.max) start();
    else this.waiting.push(start);
    return true;
  }
  snapshot() {
    return { inFlight: this.inFlight, queued: this.waiting.length };
  }
}

const running = new Map<string, AbortController>();

export function cancelAgent(turnId: string): boolean {
  const c = running.get(turnId);
  if (!c) return false;
  c.abort();
  return true;
}

export function isAgentRunning(turnId: string): boolean {
  return running.has(turnId);
}

/** Run one job to completion. Never throws. */
export async function runAgentJob(
  job: AgentJob,
  secret: string,
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void },
  fetcher: typeof fetch = fetch,
): Promise<"finished" | "cancelled" | "failed"> {
  if (running.has(job.turnId)) return "finished"; // same turn already running here
  const controller = new AbortController();
  running.set(job.turnId, controller);
  const started = Date.now();
  try {
    const { url, init } = internalGenerateRequest(job, secret);
    const res = await fetcher(url, { ...init, signal: controller.signal });
    if (!res.ok || !res.body) {
      log.warn({ turnId: job.turnId, status: res.status }, "agent job rejected by app");
      return "failed";
    }
    const reader = res.body.getReader();
    while (!(await reader.read()).done) {
      /* drain — events are recorded by the pipeline */
    }
    log.info({ turnId: job.turnId, ms: Date.now() - started }, "agent job finished");
    return "finished";
  } catch (e) {
    if (controller.signal.aborted) {
      log.info({ turnId: job.turnId }, "agent job cancelled");
      return "cancelled";
    }
    log.warn({ turnId: job.turnId, err: (e as Error).message }, "agent job failed");
    return "failed";
  } finally {
    running.delete(job.turnId);
  }
}
