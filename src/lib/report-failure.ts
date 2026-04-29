/**
 * Best-effort failure reporter.
 *
 * Fires only when `toFriendlyError` falls through to the generic
 * "Petal got a bit confused" branch — i.e. the cases we DON'T have a pattern
 * for. Insert goes through the public /api/public/track-failure route so it
 * works even when the user's session has expired or the page is being
 * unloaded.
 *
 * Never throws. Never blocks. Never logs PII.
 */
export interface FailureReportContext {
  surface?: "generate" | "discuss" | "build" | "unknown";
  projectId?: string | null;
  userId?: string | null;
  toolName?: string | null;
  model?: string | null;
  streamTail?: string | null;
  extra?: Record<string, unknown>;
}

const RECENT = new Map<string, number>();
const DEDUP_WINDOW_MS = 30_000;

export function reportPipelineFailure(
  rawMessage: string,
  ctx: FailureReportContext = {},
): void {
  if (!rawMessage || typeof rawMessage !== "string") return;
  if (typeof window === "undefined") return; // SSR no-op

  const sig = rawMessage.replace(/\s+/g, " ").slice(0, 200);
  const now = Date.now();
  const last = RECENT.get(sig);
  if (last && now - last < DEDUP_WINDOW_MS) return;
  RECENT.set(sig, now);
  // Trim the dedup map periodically.
  if (RECENT.size > 100) {
    for (const [k, t] of RECENT) {
      if (now - t > DEDUP_WINDOW_MS) RECENT.delete(k);
    }
  }

  const body = JSON.stringify({
    surface: ctx.surface ?? "unknown",
    raw_message: rawMessage.slice(0, 8000),
    tool_name: ctx.toolName ?? null,
    model: ctx.model ?? null,
    project_id: ctx.projectId ?? null,
    user_id: ctx.userId ?? null,
    stream_tail: ctx.streamTail ? ctx.streamTail.slice(-2000) : null,
    url: window.location?.href?.slice(0, 500) ?? null,
    extra: ctx.extra ?? {},
  });

  // Prefer sendBeacon — survives page navigation and stream aborts.
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/public/track-failure", blob);
      return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    void fetch("/api/public/track-failure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // swallow — never block the UI for telemetry
  }
}
