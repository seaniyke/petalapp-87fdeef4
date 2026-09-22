import { getSupabaseAccessToken } from "@/lib/auth-token";
import { throwIfCreditsExhausted } from "@/lib/friendly-errors";
import type { ChatMessage, ProjectFile, StreamEvent } from "@/server/generate.server";

type Handlers = {
  onStatus?: (message: string) => void;
  onPlanDelta?: (delta: string) => void;
  onSummaryDelta?: (delta: string) => void;
  onRecapDelta?: (delta: string) => void;
  onTool?: (name: "write_project" | "patch_files") => void;
  /** Running (not yet settled) credit estimate for this turn. */
  onCreditsEstimate?: (credits: number) => void;
  onCreditsPaused?: (pause: { checkpointId: string; requiredCredits: number }) => void;
  onPhase?: (phase: "thinking" | "designing" | "writing" | "polishing") => void;
  onDesignVibe?: (vibe: string, rationale: string) => void;
  onFileProgress?: (written: number, latestPath?: string) => void;
  onFileComplete?: (path: string, bytes: number, index: number, content?: string) => void;
  /** Per-file structural validator result (plan #2). `ok:false` means the
   *  cheap local verifier found a structural issue; the post-stream
   *  autofix tier will attempt repair. */
  onFileValidated?: (path: string, ok: boolean, errors?: string[]) => void;
  /** Plan-first — the model's ordered checklist, streamed before any file. */
  onBuildSteps?: (steps: string[]) => void;
  /** Plan-first — a checklist item moved to active/done. */
  onStepStatus?: (index: number, status: "active" | "done") => void;
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
      | "image_resolve"
      | "prd_contract"
      | "agent_tool";
    outcome: "ok" | "fixed" | "skipped" | "failed";
    message: string;
    count?: number;
    /** Public URL of a picture that just landed. */
    url?: string;
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
    /** Kimble proposed this on its own rather than because "Plan first" was on. */
    auto?: boolean;
  }) => void;
  /** Plan Mode v2 — auto-plan was wanted but could not be produced. The client
   *  should silently resend the same turn with `autoPlan: false`. */
  onPlanSkipped?: (reason: string) => void;
  /** Plan Mode v1 — patch tried to touch files outside the approved scope. */
  onPlanScopeViolation?: (droppedPaths: string[]) => void;
  /** Iteration Standard — the one honest terminal state of the turn, derived
   *  from a byte diff of the project rather than the model's prose. */
  onTurnOutcome?: (outcome: {
    outcome: "applied" | "answered" | "blocked" | "failed";
    changedPaths: string[];
    blockedPaths?: string[];
    reason?: string;
  }) => void;
  /** Fired once at the very start of every turn. The client should persist
   *  this id (e.g. to localStorage keyed by projectId) so it can silently
   *  reconnect via /api/turns/$id/events after a tab close or refresh. */
  onTurnId?: (turnId: string) => void;
  /** The message asked for a part of Kimble itself — open that area. */
  onOpenSurface?: (surface: string) => void;
  /** Fired once at the end of every turn (success, failure, or abort).
   *  The client should clear any persisted turn_id on receipt. */
  onDone?: (status: "succeeded" | "failed" | "aborted" | "awaiting_credits" | "plan_proposed") => void;
  /** The turn hit a transient failure and is finishing itself server-side.
   *  The client stays in its working state and shows no failure. */
  onRecovering?: () => void;
  /** The connection dropped mid-turn AND the quick reconnect attempts were
   *  exhausted (e.g. the phone went offline for minutes). The turn is still
   *  running server-side under this id — the caller should stay in a calm
   *  waiting state and let the auto-reconnect watcher resume it, instead of
   *  showing an error card. */
  onReconnectDeferred?: (turnId: string) => void;
};

/** Stream a generation request to /api/generate. Resolves once the stream ends. */
export async function streamGenerate(
  body: {
    messages: ChatMessage[];
    currentFiles: ProjectFile[];
    model?: "fast" | "smart" | "best" | "deep";
    customInstructions?: string;
    projectId?: string;
    /** When true, this is a silent internal recovery triggered by Kimble after
     *  its own failure. It remains balance-gated but is not charged again. */
    isAutoFix?: boolean;
    /** Plan Mode — propose a plan first instead of generating immediately. */
    planFirst?: boolean;
    /** Plan Mode — resume after the user approved a previously-proposed plan. */
    approvedPlanId?: string;
    /** Plan Mode — user-edited subset of the plan's file list to allow. */
    allowedPaths?: string[];
    /** Plan Mode v2 — set false to skip the automatic plan proposal. */
    autoPlan?: boolean;
    /** Canonical restatement produced by triage. Planning, generation and QA
     * use this same contract so the turn cannot drift from the user's ask. */
    intentBrief?: string;
    /** Client-minted turn id (UUID). Persisted before the request goes out so
     *  even a drop before the first response byte leaves a resumable handle.
     *  The server adopts it as the turn row id and dedupes retried sends. */
    turnId?: string;
    /** Build target chip (web / android / ios / backend / extension). */
    buildTarget?: string;
    /** What the user is currently looking at in the preview: the open route
     *  and, when one was picked, the selected element. Lets "this page" /
     *  "this button" resolve to the right place instead of a guess. */
    viewContext?: {
      path?: string;
      title?: string;
      heading?: string | null;
      element?: {
        tag?: string;
        text?: string;
        id?: string | null;
        classes?: string | null;
        sourceFile?: string | null;
        sourceLine?: string | null;
      } | null;
    };
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
    // 409 + x-kimble-turn-id: this exact turn was already accepted by the
    // server (a retried send after a pre-first-byte drop). Attach to the
    // running turn instead of failing or starting a second build.
    if (resp.status === 409) {
      const existingTurnId = resp.headers.get("x-kimble-turn-id");
      if (existingTurnId) {
        const completed = await streamResumeTurn(existingTurnId, 0, handlers, signal);
        if (completed) return;
        if (handlers.onReconnectDeferred) {
          handlers.onReconnectDeferred(existingTurnId);
          return;
        }
      }
    }
    const text = await resp.text().catch(() => "");
    // Dedicated "Buy credits" card instead of the generic fallback.
    throwIfCreditsExhausted(resp, text);
    throw new Error(text || `Request failed (${resp.status})`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let turnId: string | null = null;
  let sawResult = false;
  let sawDone = false;
  /** Plan Mode: a proposal IS the end of the turn — Kimble is waiting for
   *  the user's answer, so a clean EOF after it must never look like a
   *  dropped build (no reconnect attempt, no fake "stopped responding"). */
  let sawPlanProposed = false;
  /** Same for an auto-plan skip: the caller resends the turn itself. */
  let sawPlanSkipped = false;

  /**
   * A mobile browser may tear down the original fetch after the server has
   * accepted the turn. Re-run neither the prompt nor the billing path: attach
   * to the already-running turn and replay its persisted events instead.
   */
  const resumeAcceptedTurn = async (): Promise<boolean> => {
    if (!turnId || signal?.aborted) return false;
    // Mobile Safari can fail both the original fetch and the first reconnect
    // while switching radio/network state. Retry only this idempotent replay
    // endpoint; never POST /api/generate again.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const completed = await streamResumeTurn(turnId, 0, handlers, signal);
        if (completed) return true;
      } catch (resumeError) {
        if (signal?.aborted) return false;
        if (attempt === 2) {
          console.warn("Turn reconnect deferred until network recovery", resumeError);
          return false;
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
    return false;
  };

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
          case "credits_estimate":
            handlers.onCreditsEstimate?.(evt.credits);
            break;
          case "credits_paused":
            handlers.onCreditsPaused?.({
              checkpointId: evt.checkpointId,
              requiredCredits: evt.requiredCredits,
            });
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
            handlers.onFileComplete?.(evt.path, evt.bytes, evt.index, evt.content);
            break;
          case "file_validated":
            handlers.onFileValidated?.(evt.path, evt.ok, evt.errors);
            break;
          case "build_steps":
            handlers.onBuildSteps?.(evt.steps);
            break;
          case "step_status":
            handlers.onStepStatus?.(evt.index, evt.status);
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
            sawResult = true;
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
          // Agent-tool activity (inspector search/read, codemod, check) rides
          // the same timeline rail as the deterministic repair passes.
          case "tool_step":
            handlers.onTimeline?.({
              step: "agent_tool",
              outcome: evt.isError ? "failed" : "ok",
              message: evt.label,
              ts: Date.now(),
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
            turnId = evt.turnId;
            handlers.onTurnId?.(evt.turnId);
            break;
          case "recovering":
            handlers.onRecovering?.();
            break;
          case "done":
            sawDone = true;
            handlers.onDone?.(evt.status);
            break;
          case "plan_proposed":
            sawPlanProposed = true;
            handlers.onPlanProposed?.({
              planId: evt.planId,
              summary: evt.summary,
              risk: evt.risk,
              files: evt.files,
              auto: evt.auto,
            });
            break;
          case "plan_skipped":
            sawPlanSkipped = true;
            handlers.onPlanSkipped?.(evt.reason);
            break;
          case "plan_scope_violation":
            handlers.onPlanScopeViolation?.(evt.droppedPaths);
            break;
          case "open_surface":
            handlers.onOpenSurface?.(evt.surface);
            break;
          case "turn_outcome":
            handlers.onTurnOutcome?.({
              outcome: evt.outcome,
              changedPaths: evt.changedPaths,
              blockedPaths: evt.blockedPaths,
              reason: evt.reason,
            });
            break;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    // A proposed plan ends the turn by design — Kimble is waiting for the
    // user. Never convert it into a reconnect attempt or an error card.
    if (sawPlanProposed || sawPlanSkipped) {
      if (sawPlanProposed && !sawDone) handlers.onDone?.("plan_proposed");
      return;
    }
    // If a result already arrived, the edit completed. Losing only the final
    // transport frame must never turn that success into a red error card or a
    // second charged build. Otherwise, resume this same accepted turn.
    if (sawResult) {
      if (!sawDone) handlers.onDone?.("succeeded");
      return;
    }
    if (await resumeAcceptedTurn()) return;
    // Long offline gap: the turn is alive server-side but we couldn't
    // reattach within the quick-retry budget. Hand off to the watcher
    // instead of surfacing an error for a build that is still running.
    if (turnId && handlers.onReconnectDeferred) {
      handlers.onReconnectDeferred(turnId);
      return;
    }
    throw e;
  }

  // A plan proposal (or an auto-plan skip that the caller turns into a
  // resend) is a complete turn, not an interrupted stream.
  if (sawPlanProposed || sawPlanSkipped) {
    if (sawPlanProposed && !sawDone) handlers.onDone?.("plan_proposed");
    return;
  }

  // A clean EOF without `done` is still an interrupted SSE response. Resume
  // the accepted server-owned turn rather than returning to the caller, where
  // it would otherwise be mistaken for an empty result and retried as a new
  // turn.
  if (!sawDone && !sawResult && (await resumeAcceptedTurn())) return;
  if (sawResult && !sawDone) handlers.onDone?.("succeeded");
  if (!sawDone && !sawResult) {
    // Same long-offline handoff as the catch path above: with a known turn
    // id, an interrupted stream is a waiting state, never an error card.
    if (turnId && handlers.onReconnectDeferred) {
      handlers.onReconnectDeferred(turnId);
      return;
    }
    throw new Error("The build is still running, but Kimble could not reconnect to its progress stream.");
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
): Promise<boolean> {
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
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return false;
    throw e;
  }

  if (!resp.ok || !resp.body) {
    // 404 / 403 / 410 — caller treats as "no in-flight turn", nothing to do.
    return false;
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
          case "credits_estimate":
            handlers.onCreditsEstimate?.((evt.credits as number) ?? 0);
            break;
          case "credits_paused":
            handlers.onCreditsPaused?.({ checkpointId: (evt.checkpointId as string) ?? "", requiredCredits: (evt.requiredCredits as number) ?? 0 });
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
              evt.content as string | undefined,
            );
            break;
          case "file_validated":
            handlers.onFileValidated?.(
              (evt.path as string) ?? "",
              Boolean(evt.ok),
              evt.errors as string[] | undefined,
            );
            break;
          case "build_steps":
            handlers.onBuildSteps?.((evt.steps as string[]) ?? []);
            break;
          case "step_status":
            handlers.onStepStatus?.(
              (evt.index as number) ?? 0,
              (evt.status as "active" | "done") ?? "done",
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
          case "recovering":
            handlers.onRecovering?.();
            break;
          case "done":
            handlers.onDone?.((evt.status as "succeeded" | "failed" | "aborted" | "awaiting_credits" | "plan_proposed") ?? "succeeded");
            return true;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return false;
    throw e;
  }
  return false;
}
