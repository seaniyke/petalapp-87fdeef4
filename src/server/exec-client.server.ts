/**
 * Worker-side client for the builder's sandboxed `/exec` endpoint.
 *
 * Petal runs on Cloudflare Workers, which has no processes and no filesystem,
 * so anything that needs to actually *run* — a codemod script, a real `rg`
 * across the tree — has to happen on the Railway builder. This module is the
 * only door to that surface; everything else goes through `agent-tools`.
 *
 * Signed with the same HMAC convention as `/build`.
 */
import type { ProjectFile } from "@/server/generate.server";
import { signRequest } from "@/server/builder.server";

export type ExecMode = "inspect" | "codemod" | "install" | "test";

export interface ExecCommand {
  bin: string;
  args: string[];
  cwd?: string;
  stdin?: string;
}

export interface ExecCommandResult {
  bin: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  timedOut: boolean;
}

export interface ExecSessionResult {
  results: ExecCommandResult[];
  changedFiles: ProjectFile[];
  deletedPaths: string[];
}

export class ExecUnavailableError extends Error {}

export function isExecConfigured(): boolean {
  return Boolean(process.env.BUILDER_URL && process.env.BUILDER_SHARED_SECRET);
}

/** Wall clock for the whole round trip; must exceed the builder's session cap. */
const REQUEST_TIMEOUT_MS = 240_000;
/** Installs and test runs are minutes-scale by nature, so they get their own budget. */
const LONG_REQUEST_TIMEOUT_MS = 15 * 60_000;

export async function runExecSession(args: {
  projectId: string;
  mode: ExecMode;
  files: ProjectFile[];
  commands: ExecCommand[];
  /** install mode only. */
  packages?: string[];
  dev?: boolean;
  signal?: AbortSignal;
}): Promise<ExecSessionResult> {
  const builderUrl = process.env.BUILDER_URL;
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!builderUrl || !sharedSecret) {
    throw new ExecUnavailableError("Command execution is not configured");
  }

  const body = JSON.stringify({
    projectId: args.projectId,
    sessionId: crypto.randomUUID(),
    mode: args.mode,
    files: args.files,
    commands: args.commands,
    packages: args.packages,
    dev: args.dev,
  });
  const { timestamp, signature } = signRequest(sharedSecret, body);
  const url = builderUrl.replace(/\/+$/, "") + "/exec";

  const controller = new AbortController();
  const budget =
    args.mode === "install" || args.mode === "test"
      ? LONG_REQUEST_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), budget);
  const onAbort = () => controller.abort();
  args.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-petal-timestamp": timestamp,
        "x-petal-signature": signature,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Exec failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as ExecSessionResult;
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Install npm packages into a real checkout and return the updated
 * package.json / lockfile. The builder validates every spec; nothing here is
 * shelled out, and no arbitrary flags can be passed.
 */
export async function runInstallSession(args: {
  projectId: string;
  files: ProjectFile[];
  packages: string[];
  dev?: boolean;
  signal?: AbortSignal;
}): Promise<ExecSessionResult> {
  return runExecSession({
    projectId: args.projectId,
    mode: "install",
    files: args.files,
    commands: [],
    packages: args.packages,
    dev: args.dev,
    signal: args.signal,
  });
}

/** Run the project's own `npm test` on a real checkout. Returns no file diff. */
export async function runTestSession(args: {
  projectId: string;
  files: ProjectFile[];
  signal?: AbortSignal;
}): Promise<ExecSessionResult> {
  return runExecSession({
    projectId: args.projectId,
    mode: "test",
    files: args.files,
    commands: [],
    signal: args.signal,
  });
}
