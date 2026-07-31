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

export type ExecMode = "inspect" | "codemod";

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

/** Wall clock for the whole round trip; the builder caps the session at 60s. */
const REQUEST_TIMEOUT_MS = 90_000;

export async function runExecSession(args: {
  projectId: string;
  mode: ExecMode;
  files: ProjectFile[];
  commands: ExecCommand[];
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
  });
  const { timestamp, signature } = signRequest(sharedSecret, body);
  const url = builderUrl.replace(/\/+$/, "") + "/exec";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
