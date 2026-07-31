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
import { materializeProject, cleanupProject, type ProjectFile } from "./fs-helpers.js";
import { buildAndDeploy, BuildError } from "./build.js";
import { runExecSession, ExecError, MAX_COMMANDS_PER_SESSION } from "./exec.js";
import {
  runInstallSession,
  runTestSession,
  DepsError,
  MAX_PACKAGES_PER_INSTALL,
} from "./deps.js";

const PORT = Number(process.env.PORT ?? 8080);
const SHARED_SECRET = process.env.BUILDER_SHARED_SECRET;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CALLBACK_URL = process.env.PETAL_CALLBACK_URL; // https://app.example.com/api/builds/callback

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_BUILDS ?? 3);
const MAX_QUEUE = Number(process.env.MAX_QUEUE ?? 50);
/** Hard ceiling on a single job so a wedged install can never leak a slot. */
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 12 * 60 * 1000);
/** Inspection/codemod sessions get their own pool so they never starve deploys. */
const MAX_CONCURRENT_EXEC = Number(process.env.MAX_CONCURRENT_EXEC ?? 4);
const MAX_EXEC_QUEUE = Number(process.env.MAX_EXEC_QUEUE ?? 30);

if (!SHARED_SECRET) throw new Error("BUILDER_SHARED_SECRET env var is required");
if (!CF_API_TOKEN) throw new Error("CLOUDFLARE_API_TOKEN env var is required");
if (!CF_ACCOUNT_ID) throw new Error("CLOUDFLARE_ACCOUNT_ID env var is required");
if (!CALLBACK_URL) throw new Error("PETAL_CALLBACK_URL env var is required");

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

fastify.get("/healthz", async () => ({
  ok: true,
  inFlight,
  queued: queue.length,
  execInFlight,
  execQueued: execQueue.length,
  // Presence of this key tells the app that /exec supports install + test modes.
  execModes: ["inspect", "codemod", "install", "test"],
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

  // 3) Acquire a build slot (or 503 if queue is full).
  try {
    await acquireSlot();
  } catch {
    return reply.code(503).send({ error: "Builder is busy, please retry" });
  }

  // 4) Respond 202 immediately, then run the build asynchronously. The caller
  //    polls our app's `project_builds` table for the result.
  reply.code(202).send({ accepted: true, buildId: body.buildId });

  // Fire-and-forget — but do NOT throw out of this handler scope.
  void runBuild(body).finally(releaseSlot);
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


function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Build exceeded ${Math.round(ms / 1000)}s and was cancelled`)),
      ms,
    );
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function runBuild(body: BuildBody): Promise<void> {
  const log = fastify.log.child({ projectId: body.projectId, buildId: body.buildId });
  log.info("Build started");
  let dir: string | null = null;
  try {
    dir = await materializeProject(body.buildId, body.files);
    const result = await withTimeout(
      buildAndDeploy(dir, body.projectId, {
        apiToken: CF_API_TOKEN!,
        accountId: CF_ACCOUNT_ID!,
      }),
      JOB_TIMEOUT_MS,
    );

    log.info({ url: result.url, durationMs: result.durationMs }, "Build succeeded");
    await postCallback({
      buildId: body.buildId,
      projectId: body.projectId,
      status: "ready",
      url: result.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const logs = err instanceof BuildError ? err.logs.slice(-4000) : message;
    log.error({ err: message }, "Build failed");
    await postCallback({
      buildId: body.buildId,
      projectId: body.projectId,
      status: "failed",
      errorMessage: message,
      logs,
    }).catch((e) => log.error({ err: String(e) }, "Callback also failed"));
  } finally {
    if (dir) await cleanupProject(body.buildId);
  }
}

type Callback =
  | { buildId: string; projectId: string; status: "ready"; url: string }
  | { buildId: string; projectId: string; status: "failed"; errorMessage: string; logs: string };

async function postCallback(payload: Callback): Promise<void> {
  const body = JSON.stringify(payload);
  const { timestamp, signature } = sign(SHARED_SECRET!, body);
  const res = await fetch(CALLBACK_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-petal-timestamp": timestamp,
      "x-petal-signature": signature,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Callback POST failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

fastify.listen({ port: PORT, host: "0.0.0.0" }, (err, addr) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`Petal Builder listening on ${addr} (max concurrent: ${MAX_CONCURRENT})`);
});
