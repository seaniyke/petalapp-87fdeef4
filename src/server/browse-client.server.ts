/**
 * Worker-side client for the builder's steerable browser (`/browse`).
 *
 * Kimble runs on Cloudflare Workers — no processes, no Chromium. Every real
 * browser interaction happens on the Railway builder, which already ships
 * Playwright for post-build verification. This module is the only door to
 * that surface; the Test Lab's agent tools go through it.
 *
 * Each call is a self-contained batch of actions in one browser context. The
 * agent observes the result and sends the next batch, which is what makes the
 * browser "steerable" without the service holding session state.
 *
 * Signed with the same HMAC convention as `/build` and `/exec`.
 */
import { signRequest } from "@/server/builder.server";

export type BrowseAction =
  | { action: "goto"; path?: string }
  | { action: "click"; selector: string; optional?: boolean }
  | { action: "type"; selector: string; value: string; optional?: boolean }
  | { action: "choose"; selector: string; value: string; optional?: boolean }
  | { action: "press"; key: string }
  | { action: "scroll"; to?: "top" | "bottom"; px?: number }
  | { action: "wait"; ms?: number; selector?: string; optional?: boolean }
  | { action: "text"; selector?: string }
  | { action: "html"; selector?: string }
  | { action: "a11y" }
  | { action: "screenshot"; width?: number; fullPage?: boolean };

export interface BrowseStepResult {
  action: string;
  ok: boolean;
  data?: string;
  image?: string;
  width?: number;
  url?: string;
  error?: string;
  durationMs: number;
}

export interface BrowseReport {
  ok: boolean;
  baseUrl: string;
  finalUrl: string;
  durationMs: number;
  steps: BrowseStepResult[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Requests the safety guard refused (payments, email, SMS). */
  suppressed?: string[];
}

export class BrowseUnavailableError extends Error {}

export const MAX_BROWSE_ACTIONS = 40;

export function isBrowseConfigured(): boolean {
  return Boolean(process.env.BUILDER_URL && process.env.BUILDER_SHARED_SECRET);
}

/**
 * Wall clock for the round trip. Generous on purpose: the builder itself stops
 * a session only when it goes silent, so this exists to release the socket,
 * not to police duration.
 */
const REQUEST_TIMEOUT_MS = 6 * 60_000;

export async function runBrowseSession(args: {
  projectId: string;
  baseUrl: string;
  actions: BrowseAction[];
  viewport?: { width: number; height: number };
  signal?: AbortSignal;
}): Promise<BrowseReport> {
  const builderUrl = process.env.BUILDER_URL;
  const sharedSecret = process.env.BUILDER_SHARED_SECRET;
  if (!builderUrl || !sharedSecret) {
    throw new BrowseUnavailableError("Browser testing is not configured");
  }
  if (!args.actions.length) {
    throw new BrowseUnavailableError("No browser actions supplied");
  }
  if (args.actions.length > MAX_BROWSE_ACTIONS) {
    throw new BrowseUnavailableError(
      `Too many browser actions (max ${MAX_BROWSE_ACTIONS} per batch)`,
    );
  }

  const body = JSON.stringify({
    projectId: args.projectId,
    sessionId: crypto.randomUUID(),
    baseUrl: args.baseUrl,
    actions: args.actions,
    viewport: args.viewport,
  });
  const { timestamp, signature } = signRequest(sharedSecret, body);
  const url = builderUrl.replace(/\/+$/, "") + "/browse";

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
      throw new Error(`Browser session failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as BrowseReport;
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Compact, model-readable digest of a session. Screenshots are stripped — they
 * are evidence for the visual pass, not tokens for a text prompt.
 */
export function summarizeBrowseReport(report: BrowseReport): string {
  const lines: string[] = [`Browser session on ${report.finalUrl} (${report.durationMs}ms)`];
  for (const step of report.steps) {
    const head = `${step.ok ? "ok" : "FAILED"} ${step.action}${step.url ? ` @ ${step.url}` : ""}`;
    lines.push(step.error ? `${head} — ${step.error}` : head);
    if (step.data) lines.push(step.data);
    if (step.image) lines.push(`[screenshot captured${step.width ? ` at ${step.width}px` : ""}]`);
  }
  if (report.pageErrors.length) {
    lines.push(`Page errors:\n${report.pageErrors.map((e) => `- ${e}`).join("\n")}`);
  }
  if (report.consoleErrors.length) {
    lines.push(`Console errors:\n${report.consoleErrors.map((e) => `- ${e}`).join("\n")}`);
  }
  if (report.failedRequests.length) {
    lines.push(`Failed requests:\n${report.failedRequests.map((e) => `- ${e}`).join("\n")}`);
  }
  return lines.join("\n");
}
