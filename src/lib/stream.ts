import { supabase } from "@/integrations/supabase/client";
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
  onResult?: (
    files: ProjectFile[],
    summary: string,
    extras?: { plan?: string; recap?: string; creditsCharged?: number },
  ) => void;
  onSelfCheck?: (verdict: {
    score: number;
    verdict: string;
    gaps: string[];
    suggestions: string[];
  }) => void;
  onError?: (message: string, suggestions?: string[]) => void;
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
  },
  handlers: Handlers,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  let resp: Response;
  try {
    resp = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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
          case "result":
            handlers.onResult?.(evt.files, evt.summary, {
              plan: evt.plan,
              recap: evt.recap,
              creditsCharged: evt.creditsCharged,
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
          case "error":
            handlers.onError?.(evt.message, evt.suggestions);
            break;
        }
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
    throw e;
  }
}
