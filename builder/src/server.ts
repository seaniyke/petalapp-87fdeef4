/**
 * Petal Builder — HTTP service that builds Petal projects and deploys them to
 * Cloudflare Pages, then notifies the main app via a signed webhook.
 *
 * Endpoints:
 *   GET  /healthz           — Railway health probe.
 *   POST /build             — Trigger a build. Async: responds 202 immediately,
 *                             then runs the build + deploy + webhook in the
 *                             background. Idempotent on (projectId, buildId).
 *
 * Auth: every /build request must carry a valid HMAC signature derived from
 * BUILDER_SHARED_SECRET. The same secret is used to sign the callback webhook
 * the main app receives.
 *
 * Concurrency: we limit to N concurrent builds (default 2) so a burst of
 * generations doesn't exhaust the Railway container. Excess requests are
 * queued in-process; if the queue exceeds MAX_QUEUE we 503 so the caller
 * can retry.
 */
import Fastify from "fastify";
import { z } from "zod";
import { verify, sign } from "./signing.js";
import {
  materializeProject,
  cleanupProject,
  materializeWorkspace,
  releaseWorkspace,
  withProjectLock,
  type ProjectFile,
} from "./fs-helpers.js";
import { buildAndDeploy, BuildError, VerificationBlockedError } from "./build.js";
import { runExecSession, ExecError, MAX_COMMANDS_PER_SESSION } from "./exec.js";
import {
  runBrowseSession,
  BrowseError,
  BROWSE_QUIET_MS,
  MAX_ACTIONS,
  type BrowseAction,
} from "./browse.js";
import { Heartbeat, withInactivity } from "./progress.js";
import {
  runInstallSession,
  runTestSession,
  DepsError,
  MAX_PACKAGES_PER_INSTALL,
} from "./deps.js";
import {
  runVerification,
  MAX_ROUTES,
  MAX_FLOWS,
  MAX_STEPS_PER_FLOW,
  VERIFY_QUIET_MS,
  type VerifyPlan,
  type VerifyReport,
} from "./verify.js";
import { callbackCandidates } from "./callback-urls.js";
import { AgentJobSchema, AgentPool, runAgentJob, cancelAgent, inProcessEnabled, inProcessFetcher } from "./agent.js";
import { DrainGate, AcceptedJobs, DRAIN_RETRY_AFTER_S, waitUntilIdle } from "./drain.js";

const PORT = Number(process.env.PORT ?? 8080);
const SHARED_SECRET = process.env.BUILDER_SHARED_SECRET;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CALLBACK_URL = process.env.PETAL_CALLBACK_URL; // https://app.example.com/api/builds/callback

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_BUILDS ?? 3);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 50);
/**
 * A job is never cut off for taking long — only for going silent. This is the
 * quiet window (no heartbeat at all) after which we treat it as wedged.
 */
const JOB_QUIET_MS = Number(process.env.JOB_QUIET_MS ?? 30 * 60 * 1000);
/** Inspection/codemod sessions get their own pool so they never starve deploys. */
const MAX_CONCURRENT_EXEC = Number(process.env.MAX_CONCURRENT_EXEC ?? 4);
const MAX_EXEC_QUEUE = Number(process.env.MAX_EXEC_QUEUE ?? 30);

if (!SHARED_SECRET) throw new Error("BUILDER_SHARED_SECRET env var is required");
if (!CF_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN env var is required");
if (!CF_ACCOUNT_ID) throw new Error("CLOUDFLARE_ACCOUNT_ID env var is required");
if (!CALLBACK_URL) throw new Error("PETAL_CALLBACK_URL env var is required");

/**
 * Deploy drain (see drain.ts). While draining, new /build and /agent/generate
 * requests get a retryable 503 and the app re-sends them; accepted work and
 * its /exec + /browse sub-calls carry on.
 */
const drain = new DrainGate();
drain.clearStale();
const acceptedBuilds = new AcceptedJobs();
const acceptedTurns = new AcceptedJobs();
/** Docker's stop timeout is 30s; leave room to close cleanly before SIGKILL. */
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 25_000);

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // We need the raw body to verify HMACs.
  bodyLimit: 32 * 1024 * 1024, // 32 MB — covers full scaffold kit + examples + user files.
});

// Capture rawBody on every JSON request for signature verification.
fastify.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    const raw = String(body ?? "");
    (req as unknown as { rawBody: string }).rawBody = raw;
    try {
      const parsed = raw.length ? JSON.parse(raw) : {};
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);
fastify.addHook("preHandler", async (req) => {
  // Keep a defensive fallback for non-JSON requests, but normal build requests
  // are verified against the exact raw JSON captured in the parser above.
  const target = req as unknown as { rawBody?: string };
  if (target.rawBody === undefined) target.rawBody = JSON.stringify(req.body ?? {});
});

/** Declarative browser verification plan, produced by the Petal app. */
const VerifyStepSchema = z.object({
  action: z.enum(["goto", "click", "fill", "select", "expectText", "expectUrl", "wait"]),
  path: z.string().max(256).optional(),
  selector: z.string().max(512).optional(),
  value: z.string().max(512).optional(),
  ms: z.number().int().min(0).max(10_000).optional(),
  optional: z.boolean().optional(),
});
const VerifyPlanSchema = z.object({
  routes: z.array(z.string().max(256)).max(MAX_ROUTES).default([]),
  auth: z
    .object({
      signupPath: z.string().max(256),
      loginPath: z.string().max(256),
      email: z.string().email().max(200),
      password: z.string().min(8).max(128),
      name: z.string().max(120).optional(),
      protectedRoutes: z.array(z.string().max(256)).max(MAX_ROUTES).default([]),
    })
    .optional(),
  flows: z
    .array(
      z.object({
        name: z.string().max(120),
        requiresAuth: z.boolean().optional(),
        steps: z.array(VerifyStepSchema).max(MAX_STEPS_PER_FLOW),
      }),
    )
    .max(MAX_FLOWS)
    .optional(),
  screenshots: z.boolean().optional(),
  // Petal deliberately prioritises substantial interior routes (dashboard,
  // detail, settings) and three responsive widths. Keep this field in the
  // parsed plan instead of letting Zod strip it and falling back to route order.
  visual: z
    .object({
      widths: z.array(z.number().int().min(320).max(1920)).max(3).optional(),
      routes: z.array(z.string().max(256)).max(4).optional(),
    })
    .optional(),
});

const FileSchema = z.object({
  path: z.string().min(1).max(512),
  content: z.string(),
});
const BuildBodySchema = z.object({
  projectId: z.string().uuid(),
  buildId: z.string().uuid(),
  // Cap raised to 2000 to accommodate the full scaffold kit (UI primitives,
  // ~150 section blocks, examples pack) plus the user's generated files.
  // The 8 MB → 32 MB bodyLimit bump above ensures we can still receive it.
  files: z.array(FileSchema).min(1).max(2000),
  /** Omitted by older callers — the build then behaves exactly as before. */
  verify: VerifyPlanSchema.optional(),
});
type BuildBody = z.infer<typeof BuildBodySchema>;

// Simple in-process semaphore + queue.
let inFlight = 0;
const queue: Array<() => void> = [];
function acquireSlot(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (inFlight < MAX_CONCURRENT) {
      inFlight++;
      return resolve();
    }
    if (queue.length >= MAX_QUEUE) {
      return reject(new Error("Builder queue full"));
    }
    queue.push(() => {
      inFlight++;
      resolve();
    });
  });
}
function releaseSlot() {
  inFlight--;
  const next = queue.shift();
  if (next) next();
}

/** Everything that would be cut off by a restart right now. */
function busyCount(): number {
  const a = agentPool.snapshot();
  return inFlight + queue.length + execInFlight + execQueue.length + a.inFlight + a.queued;
}

/** Retryable refusal while a deploy is draining this builder. */
function refuseDraining(reply: import("fastify").FastifyReply) {
  return reply
    .code(503)
    .header("Retry-After", String(DRAIN_RETRY_AFTER_S))
    .send({ error: "Builder is updating, please retry", draining: true });
}

fastify.get("/healthz", async () => ({
  ok: true,
  // Presence tells the deploy script this builder supports drain mode.
  drain: true,
  draining: drain.isDraining(),
  inFlight,
  queued: queue.length,
  execInFlight,
  execQueued: execQueue.length,
  // Presence of this key tells the app that /exec supports install + test modes.
  execModes: ["inspect", "codemod", "install", "test"],
  // Presence tells the app that /build can run post-deploy browser verification.
  verify: true,
  // Presence tells the app that /browse (steerable browser) is available.
  browse: true,
  // Progress-based liveness: a build is only ever stopped for going silent.
  active: [...activeBeats.entries()].map(([buildId, hb]) => ({
    buildId,
    ...hb.snapshot(),
    quietMs: hb.quietFor(),
  })),
}));

fastify.post("/build", async (req, reply) => {
  // 1) Verify signature.
  const ts = req.headers["x-petal-timestamp"] as string | undefined;
  const sig = req.headers["x-petal-signature"] as string | undefined;
  const raw = (req as unknown as { rawBody: string }).rawBody;
  if (!verify(SHARED_SECRET, raw, ts, sig)) {
    req.log.warn({ ts }, "Rejected build: bad signature");
    return reply.code(401).send({ error: "Invalid signature" });
  }

  // 2) Validate body.
  const parsed = BuildBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const body: BuildBody = parsed.data;

  // 3) A re-sent request for a build already queued or running here is
  //    acknowledged, never started twice (the app retries lost responses).
  if (acceptedBuilds.has(body.buildId)) {
    return reply.code(202).send({ accepted: true, buildId: body.buildId, duplicate: true });
  }
  // 4) A deploy is draining this builder: the app holds the build and
  //    re-sends it to the next builder that answers.
  if (drain.isDraining()) return refuseDraining(reply);

  // 5) Acquire a build slot (or 503 if queue is full).
  acceptedBuilds.begin(body.buildId);
  try {
    await acquireSlot();
  } catch {
    acceptedBuilds.end(body.buildId);
    return reply.code(503).send({ error: "Builder is busy, please retry" });
  }

  // 6) Respond 202 immediately, then run the build asynchronously. The caller
  //    polls our app's `project_builds` table for the result.
  reply.code(202).send({ accepted: true, buildId: body.buildId });

  // Fire-and-forget — but do NOT throw out of this handler scope.
  void runBuild(body).finally(() => {
    acceptedBuilds.end(body.buildId);
    releaseSlot();
  });
});

// ---------------------------------------------------------------------------
// /exec — sandboxed inspection + codemod sessions.
//
// Deliberately synchronous (unlike /build): sessions are capped at 60s and the
// caller — Petal's agent loop — needs the output inline to decide what to do
// next. Runs on its own slot pool so an inspection burst can never starve a
// deploy.
// ---------------------------------------------------------------------------

const ExecCommandSchema = z.object({
  bin: z.string().min(1).max(64),
  args: z.array(z.string().max(4096)).max(64).default([]),
  cwd: z.string().max(512).optional(),
  stdin: z.string().max(256 * 1024).optional(),
});
const ExecBodySchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  mode: z.enum(["inspect", "codemod", "install", "test"]),
  files: z.array(FileSchema).min(1).max(2000),
  /** Required for inspect/codemod; ignored by install/test. */
  commands: z.array(ExecCommandSchema).max(MAX_COMMANDS_PER_SESSION).default([]),
  /** install mode only. */
  packages: z.array(z.string().max(128)).max(MAX_PACKAGES_PER_INSTALL).optional(),
  dev: z.boolean().optional(),
});

let execInFlight = 0;
const execQueue: Array<() => void> = [];
function acquireExecSlot(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (execInFlight < MAX_CONCURRENT_EXEC) {
      execInFlight++;
      return resolve();
    }
    if (execQueue.length >= MAX_EXEC_QUEUE) {
      return reject(new Error("Exec queue full"));
    }
    execQueue.push(() => {
      execInFlight++;
      resolve();
    });
  });
}
function releaseExecSlot() {
  execInFlight--;
  const next = execQueue.shift();
  if (next) next();
}

// ---- Durable agent jobs (generation runs here, not on the browser's socket) ----
const agentPool = new AgentPool(
  Number(process.env.MAX_CONCURRENT_AGENTS ?? 8),
  Number(process.env.MAX_AGENT_QUEUE ?? 50),
);
// Bump when the vendored agent core changes, so a live check can confirm the deploy.
const AGENT_CORE_VERSION = "2026-11-10-no-placeholder-pages";
// sha256 of the vendored bundle actually on disk in this container — compare
// with builder/vendor/agent-core.version.json to prove what production runs.
const AGENT_CORE_HASH: string = await (async () => {
  try {
    const { readFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const buf = await readFile(new URL("../vendor/agent-core.mjs", import.meta.url));
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "unavailable";
  }
})();
fastify.get("/agent/healthz", async () => ({ ok: true, version: AGENT_CORE_VERSION, coreHash: AGENT_CORE_HASH, inProcess: inProcessEnabled(), ...agentPool.snapshot() }));

fastify.post("/agent/generate", async (req, reply) => {
  const ts = req.headers["x-petal-timestamp"] as string | undefined;
  const sig = req.headers["x-petal-signature"] as string | undefined;
  const raw = (req as unknown as { rawBody: string }).rawBody;
  if (!verify(SHARED_SECRET, raw, ts, sig)) {
    return reply.code(401).send({ error: "Invalid signature" });
  }
  const parsed = AgentJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const job = parsed.data;
  // Same turn already queued or running here: acknowledge, don't run it twice.
  if (acceptedTurns.has(job.turnId)) {
    return reply.code(202).send({ accepted: true, turnId: job.turnId, duplicate: true });
  }
  if (drain.isDraining()) return refuseDraining(reply);
  acceptedTurns.begin(job.turnId);
  const accepted = agentPool.tryEnqueue(async () => {
    try {
      await runAgentJob(job, SHARED_SECRET, req.log, inProcessEnabled() ? inProcessFetcher(job, SHARED_SECRET) : fetch);
    } finally {
      acceptedTurns.end(job.turnId);
    }
  });
  if (!accepted) {
    acceptedTurns.end(job.turnId);
    return reply.code(503).send({ error: "Builder is busy, please retry" });
  }
  return reply.code(202).send({ accepted: true, turnId: job.turnId });
});

fastify.post("/agent/cancel", async (req, reply) => {
  const ts = req.headers["x-petal-timestamp"] as string | undefined;
  const sig = req.headers["x-petal-signature"] as string | undefined;
  const raw = (req as unknown as { rawBody: string }).rawBody;
  if (!verify(SHARED_SECRET, raw, ts, sig)) {
    return reply.code(401).send({ error: "Invalid signature" });
  }
  const turnId = (req.body as { turnId?: unknown } | null)?.turnId;
  if (typeof turnId !== "string") return reply.code(400).send({ error: "turnId required" });
  return reply.send({ cancelled: cancelAgent(turnId) });
});

fastify.post("/exec", async (req, reply) => {
  const ts = req.headers["x-petal-timestamp"] as string | undefined;
  const sig = req.headers["x-petal-signature"] as string | undefined;
  const raw = (req as unknown as { rawBody: string }).rawBody;
  if (!verify(SHARED_SECRET, raw, ts, sig)) {
    req.log.warn({ ts }, "Rejected exec: bad signature");
    return reply.code(401).send({ error: "Invalid signature" });
  }

  const parsed = ExecBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  try {
    await acquireExecSlot();
  } catch {
    return reply.code(503).send({ error: "Exec pool is busy, please retry" });
  }

  const log = fastify.log.child({ projectId: body.projectId, sessionId: body.sessionId });
  let dir: string | null = null;
  try {
    dir = await materializeProject(body.sessionId, body.files);
    const out =
      body.mode === "install"
        ? await runInstallSession({
            root: dir,
            packages: body.packages ?? [],
            dev: Boolean(body.dev),
            original: body.files,
          })
        : body.mode === "test"
          ? await runTestSession({ root: dir })
          : await runExecSession({
              root: dir,
              mode: body.mode,
              commands: body.commands,
              original: body.files,
            });
    log.info(
      { commands: out.results.length, changed: out.changedFiles.length },
      "Exec session finished",
    );
    return reply.code(200).send(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "Exec session failed");
    const status = err instanceof ExecError || err instanceof DepsError ? 400 : 500;
    return reply.code(status).send({ error: message });
  } finally {
    if (dir) await cleanupProject(body.sessionId);
    releaseExecSlot();
  }
});

// ---------------------------------------------------------------------------
// /browse — steerable browser session.
//
// The Test Lab's eyes and hands. Unlike /build's fixed verification script,
// this executes an agent-chosen batch of actions against a *running* app and
// returns everything observed, so the next batch can be decided from evidence.
// Stateless per request: no session is retained between calls.
// ---------------------------------------------------------------------------

const BrowseActionSchema = z.object({
  action: z.enum([
    "goto",
    "click",
    "type",
    "choose",
    "press",
    "scroll",
    "wait",
    "text",
    "html",
    "a11y",
    "screenshot",
  ]),
  path: z.string().max(512).optional(),
  selector: z.string().max(512).optional(),
  value: z.string().max(512).optional(),
  key: z.string().max(32).optional(),
  to: z.enum(["top", "bottom"]).optional(),
  px: z.number().int().min(-20_000).max(20_000).optional(),
  ms: z.number().int().min(0).max(10_000).optional(),
  width: z.number().int().min(320).max(2560).optional(),
  fullPage: z.boolean().optional(),
  optional: z.boolean().optional(),
});
const BrowseBodySchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
  baseUrl: z.string().url().max(512),
  actions: z.array(BrowseActionSchema).min(1).max(MAX_ACTIONS),
  viewport: z
    .object({
      width: z.number().int().min(320).max(2560),
      height: z.number().int().min(400).max(2000),
    })
    .optional(),
});

fastify.post("/browse", async (req, reply) => {
  const ts = req.headers["x-petal-timestamp"] as string | undefined;
  const sig = req.headers["x-petal-signature"] as string | undefined;
  const raw = (req as unknown as { rawBody: string }).rawBody;
  if (!verify(SHARED_SECRET, raw, ts, sig)) {
    req.log.warn({ ts }, "Rejected browse: bad signature");
    return reply.code(401).send({ error: "Invalid signature" });
  }

  const parsed = BrowseBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  try {
    await acquireExecSlot();
  } catch {
    return reply.code(503).send({ error: "Browser pool is busy, please retry" });
  }

  const log = fastify.log.child({ projectId: body.projectId, sessionId: body.sessionId });
  const heartbeat = new Heartbeat("opening the browser");
  try {
    const report = await withInactivity(
      runBrowseSession(
        {
          baseUrl: body.baseUrl,
          actions: body.actions as BrowseAction[],
          viewport: body.viewport,
        },
        heartbeat,
      ),
      BROWSE_QUIET_MS,
      heartbeat,
    );
    log.info({ steps: report.steps.length, ok: report.ok }, "Browse session finished");
    return reply.code(200).send(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "Browse session failed");
    return reply.code(err instanceof BrowseError ? 400 : 500).send({ error: message });
  } finally {
    releaseExecSlot();
  }
});


/** Live progress of every in-flight build, surfaced on /healthz. */
const activeBeats = new Map<string, Heartbeat>();

/**
 * Petal v3 — Phase D. Warm workspaces are opt-out (`WARM_WORKSPACES=0`) so a
 * bad disk state on one host can be turned off without a redeploy.
 */
const WARM_WORKSPACES = process.env.WARM_WORKSPACES !== "0";

async function runBuild(body: BuildBody): Promise<void> {
  if (WARM_WORKSPACES) {
    // One build per project at a time. Two turns sharing a warm directory
    // would interleave writes into the same source tree, which is the one way
    // a reused workspace can produce a wrong build rather than a slow one.
    return withProjectLock(body.projectId, () => runBuildInner(body));
  }
  return runBuildInner(body);
}

async function runBuildInner(body: BuildBody): Promise<void> {
  const log = fastify.log.child({ projectId: body.projectId, buildId: body.buildId });
  log.info("Build started");
  let dir: string | null = null;
  let warmed = false;
  // Declared outside the try so the failure path can forward the exact
  // defects that blocked the deploy.
  let verification: VerifyReport | undefined;
  const heartbeat = new Heartbeat("preparing the workspace");
  activeBeats.set(body.buildId, heartbeat);
  // Tell Petal we are alive on a fixed cadence. This is what lets the app
  // keep a long build running instead of reaping it on a wall clock.
  const beatTimer = setInterval(() => {
    void postHeartbeat(body.buildId, body.projectId, heartbeat.snapshot().label);
  }, HEARTBEAT_INTERVAL_MS);
  try {
    if (WARM_WORKSPACES) {
      try {
        const ws = await materializeWorkspace(body.projectId, body.files);
        dir = ws.dir;
        warmed = true;
        log.info(
          { warm: ws.warm, pruned: ws.pruned.length },
          ws.warm
            ? "Reusing warm workspace (node_modules retained)"
            : "Cold workspace created",
        );
      } catch (err) {
        // Warmth is an optimization, never a correctness dependency.
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "Warm workspace unavailable, falling back to a scratch build",
        );
        dir = null;
        warmed = false;
      }
    }
    if (!dir) dir = await materializeProject(body.buildId, body.files);
    // Browser verification now runs BEFORE the deploy, against a throwaway
    // localhost server over the built `dist/`. A runtime failure therefore
    // aborts the upload instead of being discovered after the fact, and CDN
    // propagation can no longer be mistaken for an app defect.
    //
    // A verifier that cannot run is not a build failure — the bundle is real
    // either way, so we record it as skipped and let the deploy proceed.
    const preDeployCheck = body.verify
      ? async (baseUrl: string): Promise<VerifyReport> => {
          const plan: VerifyPlan = { baseUrl, ...body.verify! };
          try {
            const report = await withInactivity(
              runVerification(plan, heartbeat),
              VERIFY_QUIET_MS,
              heartbeat,
            );
            log.info(
              { ok: report.ok, defects: report.defects.length },
              "Pre-deploy verification finished",
            );
            verification = stripScreenshots(report);
            return verification;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn({ err: message }, "Verification could not run");
            verification = {
              ok: true,
              baseUrl,
              durationMs: 0,
              routes: [],
              flows: [],
              defects: [],
              skipped: message.slice(0, 300),
            } as VerifyReport & { skipped: string };
            return verification;
          }
        }
      : undefined;

    const result = await withInactivity(
      buildAndDeploy(
        dir,
        body.projectId,
        { apiToken: CF_API_TOKEN!, accountId: CF_ACCOUNT_ID! },
        preDeployCheck ? { preDeployCheck, heartbeat } : { heartbeat },
      ),
      JOB_QUIET_MS,
      heartbeat,
    );

    log.info({ url: result.url, durationMs: result.durationMs }, "Build succeeded");

    try {
      await postCallback({
        buildId: body.buildId,
        projectId: body.projectId,
        status: "ready",
        url: result.url,
        ...(verification ? { verification } : {}),
        timings: {
          ...(typeof (body as { turnId?: unknown }).turnId === "string" ? { turnId: (body as { turnId?: string }).turnId as string } : {}),
          ...(verification?.durationMs != null ? { browserMs: verification.durationMs } : {}),
        },
      });
    } catch (e) {
      // The app is deployed. A slow or lost acknowledgement is not a build
      // failure — the app side may already have recorded it, and the
      // reconciler recovers it otherwise. Never report "failed" here.
      log.error({ err: String(e) }, "Ready callback not acknowledged; leaving to reconciler");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const logs = err instanceof BuildError ? err.logs.slice(-4000) : message;
    log.error({ err: message }, "Build failed");
    // A blocked verification carries the exact defects that stopped the
    // deploy. Forward them structurally so the app can aim a repair at them
    // rather than re-deriving intent from a log blob.
    await postCallback({
      buildId: body.buildId,
      projectId: body.projectId,
      status: "failed",
      errorMessage: message,
      logs,
      ...(err instanceof VerificationBlockedError && verification ? { verification } : {}),
      // Lets the app tell "never went live" from "live, then a late problem".
      deployed: false,
      timings: {
        ...(typeof (body as { turnId?: unknown }).turnId === "string" ? { turnId: (body as { turnId?: string }).turnId as string } : {}),
        ...(verification?.durationMs != null ? { browserMs: verification.durationMs } : {}),
      },
    }).catch((e) => log.error({ err: String(e) }, "Callback also failed"));
  } finally {
    clearInterval(beatTimer);
    activeBeats.delete(body.buildId);
    if (warmed) {
      // Keep node_modules for the next turn; drop only the build output.
      await releaseWorkspace(body.projectId);
    } else if (dir) {
      await cleanupProject(body.buildId);
    }
  }
}

/**
 * Screenshots are megabytes of base64 and the webhook body is signed and
 * parsed whole — keep them on this side of the wire.
 */
function stripScreenshots(report: VerifyReport): VerifyReport {
  return {
    ...report,
    routes: report.routes.map(({ screenshot: _s, ...rest }) => rest),
    flows: report.flows.map(({ screenshot: _s, ...rest }) => rest),
    ...(report.auth ? { auth: { ...report.auth, screenshot: undefined } } : {}),
  };
}

const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 20_000);
/** Derived from the callback URL: /api/builds/callback -> /api/public/builds/heartbeat */
const HEARTBEAT_URL = (() => {
  try {
    const u = new URL(CALLBACK_URL!);
    u.pathname = "/api/public/builds/heartbeat";
    return u.toString();
  } catch {
    return null;
  }
})();

/**
 * Best-effort liveness ping. Never throws and never blocks the build: a
 * missed heartbeat only shortens the app's patience, it cannot fail a job.
 */
async function postHeartbeat(
  buildId: string,
  projectId: string,
  label: string,
): Promise<void> {
  if (!HEARTBEAT_URL) return;
  try {
    const body = JSON.stringify({ buildId, projectId, label: label.slice(0, 120) });
    const { timestamp, signature } = sign(SHARED_SECRET!, body);
    await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-petal-timestamp": timestamp,
        "x-petal-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* liveness is advisory */
  }
}

type Callback =
  | {
      buildId: string;
      projectId: string;
      status: "ready";
      url: string;
      verification?: VerifyReport;
      timings?: Record<string, string | number>;
    }
  | {
      buildId: string;
      projectId: string;
      status: "failed";
      errorMessage: string;
      logs: string;
      verification?: VerifyReport;
      deployed?: boolean;
      timings?: Record<string, string | number>;
    };


async function postCallback(payload: Callback): Promise<void> {
  const body = JSON.stringify(payload);
  const delays = [0, 1_000, 3_000, 8_000, 15_000];
  let lastError = "Callback did not complete";
  const candidates = callbackCandidates(CALLBACK_URL!);

  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    for (const callbackUrl of candidates) {
      // Sign each attempt with a fresh timestamp. Reusing the first signature
      // can make a later retry fail the callback endpoint's five-minute window.
      const { timestamp, signature } = sign(SHARED_SECRET!, body);
      try {
        const res = await fetch(callbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-petal-timestamp": timestamp,
            "x-petal-signature": signature,
          },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) return;
        const responseBody = await res.text().catch(() => "");
        lastError = `Callback POST failed: ${res.status} ${responseBody}`;
        // A stale public deployment commonly answers 404/500 while the stable
        // project URL is healthy. Always try every candidate before waiting.
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  throw new Error(lastError);
}

/**
 * Graceful stop. Node as a container's PID 1 ignores SIGTERM unless it has a
 * handler, so `docker stop` used to wait its full timeout and then SIGKILL.
 * Now: refuse new jobs, let running ones finish (up to SHUTDOWN_GRACE_MS),
 * close, exit. An idle builder exits at once, which keeps the deploy swap gap
 * to the new container's start-up time.
 */
async function shutdown(signal: string): Promise<void> {
  if (drain.isShuttingDown()) return;
  drain.beginShutdown();
  fastify.log.info({ signal, busy: busyCount() }, "Shutting down: refusing new jobs");
  const idle = await waitUntilIdle(busyCount, SHUTDOWN_GRACE_MS);
  if (!idle) fastify.log.warn({ busy: busyCount() }, "Shutdown grace ended with work still running");
  await fastify.close().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err, addr) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Petal Builder listening on ${addr} (max concurrent: ${MAX_CONCURRENT})`);
});
