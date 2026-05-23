import { getSupabaseAccessToken } from "@/lib/auth-token";
import type { ChatMessage, ProjectFile, StreamEvent } from "@/server/generate.server";

type Handlers = {
  onStatus?: (message: string) => void;
  onPlanDelta?: (delta: string) => void;
  onSummaryDelta?: (delta: string) => void;
  onRecapDelta?: (delta: string) => void;
  onTool?: (name: "write_project" | "patch_files") => void;
  onPhase?: (phase: "thinking" | "designing" | "writing" | "polishing") => void;
  onDesignVibe?: (vibe: string, rationale: string) => void;
  onFileProgress?: (written: number, latestPath?: string) => void;
  onFileComplete?: (path: string, bytes: number, index: number) => void;
  /** Per-file structural validator result (plan #2). `ok:false` means the
   *  cheap local verifier found a structural issue; the post-stream
   *  autofix tier will attempt repair. */
  onFileValidated?: (path: string, ok: boolean, errors?: string[]) => void;
  /** Model-written one-liner about the file it's about to build. */
  onNarration?: (path: string, text: string) => void;
  /** Agentic-loop cycle started (initial write or a bounded fix round). */
  onCycleStart?: (cycle: number, intent: "writing" | "fixing" | "verifying") => void;
  /** Live "what's happening right now" string between file events. */
  onCycleProgress?: (cycle: number, message: string) => void;
  /** Cycle resolved — clean, retrying, or hit a hard stop. */
  onCycleEnd?: (cycle: number, outcome: "clean" | "retrying" | "hard-stop") => void;
  onResult?: (
    files: ProjectFile[],
    summary: string,
    extras?: {
      plan?: string;
      recap?: string;
      creditsCharged?: number;
      noFileChanges?: boolean;
      /** Two-phase gate: backend chips proposed for the NEXT turn. */
      suggestions?: string[];
    },
  ) => void;
  onSelfCheck?: (verdict: {
    score: number;
    verdict: string;
    gaps: string[];
    suggestions: string[];
  }) => void;
  onTimeline?: (entry: {
    step:
      | "stream_autofix"
      | "local_verifier"
      | "npm_preflight"
      | "continuation"
      | "esbuild_parse"
      | "render_risk"
      | "rls_sanity"
      | "file_budget"
      | "post_stream_autofix"
      | "image_resolve";
    outcome: "ok" | "fixed" | "skipped" | "failed";
    message: string;
    count?: number;
    ts: number;
  }) => void;
  // NOTE: `onContinuationHandoff` was removed along with the
  // Continue-building chip. The server no longer emits the event.
  onError?: (
    message: string,
    suggestions?: string[],
    /** Structured failure code from the server. Pass through to
     *  toFriendlyError — do NOT regex the message. */
    kind?: import("@/server/generate.server").ErrorKind,
    /** Raw, un-humanized error string from the server (when available).
     *  Use this for telemetry / pipeline_failures so root-cause analysis
     *  isn't blinded by LLM-rewritten apology copy. */
    raw?: string,
  ) => void;
  /** Plan Mode v1 — server proposed a scoped plan. The stream then ends and
   *  the composer renders an approval card. */
  onPlanProposed?: (plan: {
    planId: string;
    summary: string;
    risk: "low" | "medium" | "high";
    files: Array<{ path: string; intent: "edit" | "create" | "delete"; reason: string }>;
  }) => void;
  /** Plan Mode v1 — patch tried to touch files outside the approved scope. */
  onPlanScopeViolation?: (droppedPaths: string[]) => void;
  /** Fired once at the very start of every turn. The client should persist
   *  this id (e.g. to localStorage keyed by projectId) so it can silently
   *  reconnect via /api/turns/$id/events after a tab close or refresh. */
  onTurnId?: (turnId: string) => void;
  /** Fired once at the end of every turn (success, failure, or abort).
   *  The client should clear any persisted turn_id on receipt. */
  onDone?: (status: "succeeded" | "failed" | "aborted") => void;
};

/** Stream a generation request to /api/generate. Resolves once the stream ends. */
export async function streamGenerate(
  body: {
    messages: ChatMessage[];
    currentFiles: ProjectFile[];
    model?: "fast" | "smart" | "best" | "deep";
    customInstructions?: string;
    projectId?: string;
    /** When true, this run is a free internal auto-fix triggered by Petal
     *  itself (after a failed build). The server skips credit charging and
     *  the client suppresses the giant prompt from the chat thread. */
    isAutoFix?: boolean;
    /** Plan Mode — propose a plan first instead of generating immediately. */
    planFirst?: boolean;
    /** Plan Mode — resume after the user approved a previously-proposed plan. */
    approvedPlanId?: string;
    /** Plan Mode — user-edited subset of the plan's file list to allow. */
    allowedPaths?: string[];
    /** Build target chip (web / android / ios / backend / extension). */
    buildTarget?: string;
  },
  handlers: Handlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error("Not signed in");

  let resp: Response;
  try {
    resp = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(body.buildTarget ? { "x-petal-target": body.buildTarget } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    throw e;
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed (${resp.status})`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const block of parts) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: StreamEvent;
        try {
          evt = JSON.parse(payload) as StreamEvent;
        } catch {
          continue;
        }
        switch (evt.type) {
          case "status":
            handlers.onStatus?.(evt.message);
            break;
          case "plan_delta":
            handlers.onPlanDelta?.(evt.delta);
            break;
          case "summary_delta":
            handlers.onSummaryDelta?.(evt.delta);
            break;
          case "recap_delta":
            handlers.onRecapDelta?.(evt.delta);
            break;
          case "tool":
            handlers.onTool?.(evt.name);
            break;
          case "phase":
            handlers.onPhase?.(evt.phase);
            break;
          case "design_vibe":
            handlers.onDesignVibe?.(evt.vibe, evt.rationale);
            break;
          case "file_progress":
            handlers.onFileProgress?.(evt.written, evt.latestPath);
            break;
          case "file_complete":
            handlers.onFileComplete?.(evt.path, evt.bytes, evt.index);
            break;
          case "narration":
            handlers.onNarration?.(evt.path, evt.text);
            break;
          case "cycle_start":
            handlers.onCycleStart?.(evt.cycle, evt.intent);
            break;
          case "cycle_progress":
            handlers.onCycleProgress?.(evt.cycle, evt.message);
            break;
          case "cycle_end":
            handlers.onCycleEnd?.(evt.cycle, evt.outcome);
            break;
          case "result":
            handlers.onResult?.(evt.files, evt.summary, {
              plan: evt.plan,
              recap: evt.recap,
              creditsCharged: evt.creditsCharged,
              noFileChanges: evt.noFileChanges,
              suggestions: evt.suggestions,
            });
            break;
          case "self_check":
            handlers.onSelfCheck?.({
              score: evt.score,
              verdict: evt.verdict,
              gaps: evt.gaps,
              suggestions: evt.suggestions,
            });
            break;
          case "timeline":
            handlers.onTimeline?.({
              step: evt.step,
              outcome: evt.outcome,
              message: evt.message,
              count: evt.count,
              ts: evt.ts,
            });
            break;
          // continuation_handoff event removed (no-op).
          case "error":
            handlers.onError?.(evt.message, evt.suggestions, evt.kind, evt.raw);
            break;
          case "turn_id":
            handlers.onTurnId?.(evt.turnId);
            break;
          case "done":
            handlers.onDone?.(evt.status);
            break;
          case "plan_proposed":
            handlers.onPlanProposed?.({
              planId: evt.planId,
              summary: evt.summary,
              risk: evt.risk,
              files: evt.files,
            });
            break;
          case "plan_scope_violation":
            handlers.onPlanScopeViolation?.(evt.droppedPaths);
            break;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    throw e;
  }
}

/**
 * Reattach to an in-flight turn via /api/turns/$id/events. Used when the
 * user closes their phone or refreshes mid-build — the pipeline keeps
 * running on the server, and this lets the UI silently rehydrate from the
 * exact event sequence number it last saw.
 *
 * The server sends a `resume_start` event first (which we ignore for UI
 * purposes), then replays missed events with their original `kind`s, then
 * tails until a `done` event arrives. Reuses the same Handlers shape as
 * streamGenerate so callers can pass the same callbacks.
 */
export async function streamResumeTurn(
  turnId: string,
  afterSeq: number,
  handlers: Handlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error("Not signed in");

  let resp: Response;
  try {
    resp = await fetch(`/api/turns/${turnId}/events?after=${afterSeq}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    throw e;
  }

  if (!resp.ok || !resp.body) {
    // 404 / 403 / 410 — caller treats as "no in-flight turn", nothing to do.
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const block of parts) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: { type: string } & Record<string, unknown>;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        // Resume-only meta events that aren't part of StreamEvent.
        if (evt.type === "resume_start" || evt.type === "resume_timeout") continue;
        // Re-dispatch through the same switch by faking a StreamEvent.
        switch (evt.type) {
          case "status":
            handlers.onStatus?.((evt.message as string) ?? "");
            break;
          case "plan_delta":
            handlers.onPlanDelta?.((evt.delta as string) ?? "");
            break;
          case "summary_delta":
            handlers.onSummaryDelta?.((evt.delta as string) ?? "");
            break;
          case "recap_delta":
            handlers.onRecapDelta?.((evt.delta as string) ?? "");
            break;
          case "tool":
            handlers.onTool?.(evt.name as "write_project" | "patch_files");
            break;
          case "phase":
            handlers.onPhase?.(evt.phase as "thinking" | "designing" | "writing" | "polishing");
            break;
          case "design_vibe":
            handlers.onDesignVibe?.((evt.vibe as string) ?? "", (evt.rationale as string) ?? "");
            break;
          case "file_progress":
            handlers.onFileProgress?.(evt.written as number, evt.latestPath as string | undefined);
            break;
          case "file_complete":
            handlers.onFileComplete?.(
              evt.path as string,
              evt.bytes as number,
              evt.index as number,
            );
            break;
          case "narration":
            handlers.onNarration?.((evt.path as string) ?? "", (evt.text as string) ?? "");
            break;
          case "result":
            handlers.onResult?.(
              (evt.files as ProjectFile[]) ?? [],
              (evt.summary as string) ?? "",
              {
                plan: evt.plan as string | undefined,
                recap: evt.recap as string | undefined,
                creditsCharged: evt.creditsCharged as number | undefined,
                noFileChanges: evt.noFileChanges as boolean | undefined,
                suggestions: evt.suggestions as string[] | undefined,
              },
            );
            break;
          case "timeline":
            handlers.onTimeline?.({
              step: evt.step as never,
              outcome: evt.outcome as never,
              message: (evt.message as string) ?? "",
              count: evt.count as number | undefined,
              ts: (evt.ts as number) ?? Date.now(),
            });
            break;
          // continuation_handoff event removed (no-op).
          case "error":
            handlers.onError?.(
              (evt.message as string) ?? "Build failed.",
              evt.suggestions as string[] | undefined,
              evt.kind as never,
              evt.raw as string | undefined,
            );
            break;
          case "done":
            handlers.onDone?.((evt.status as "succeeded" | "failed" | "aborted") ?? "succeeded");
            return;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    throw e;
  }
}
