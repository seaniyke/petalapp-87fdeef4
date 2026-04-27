/**
 * Client helper for /api/triage. Streams a warm preamble reply token-by-token
 * and resolves with the classifier's final intent ("chat" | "clarify" | "build").
 *
 * The builder uses this BEFORE deciding whether to kick off /api/generate, so
 * conversational turns ("hi", "thanks", "what can you do?") never trigger the
 * full build pipeline UI.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";

export type TriageIntent = "chat" | "clarify" | "build";

type Handlers = {
  onReplyDelta?: (delta: string) => void;
  onIntent?: (intent: TriageIntent) => void;
  onError?: (message: string) => void;
};

export type TriageResult = {
  reply: string;
  intent: TriageIntent;
};

export async function streamTriage(
  body: {
    messages: ChatMessage[];
    currentFiles: ProjectFile[];
    customInstructions?: string;
  },
  handlers: Handlers,
  signal?: AbortSignal,
): Promise<TriageResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  let resp: Response;
  try {
    resp = await fetch("/api/triage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      return { reply: "", intent: "build" };
    }
    throw e;
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Triage failed (${resp.status})`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  // Default to "build" so a parsing/network glitch never silently swallows
  // a real build request — the user can always retry, but losing a build
  // request is the more confusing failure.
  let intent: TriageIntent = "build";

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
        let evt:
          | { type: "reply_delta"; delta: string }
          | { type: "intent"; intent: TriageIntent }
          | { type: "error"; message: string };
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type === "reply_delta") {
          reply += evt.delta;
          handlers.onReplyDelta?.(evt.delta);
        } else if (evt.type === "intent") {
          intent = evt.intent;
          handlers.onIntent?.(evt.intent);
        } else if (evt.type === "error") {
          handlers.onError?.(evt.message);
        }
      }
    }
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) {
      return { reply, intent };
    }
    throw e;
  }

  return { reply, intent };
}
