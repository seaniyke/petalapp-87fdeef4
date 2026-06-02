/**
 * Client helper for /api/triage. Streams a warm preamble reply token-by-token
 * AND captures the structured `meta` (mode, scope, suggestions, …) so the
 * builder can adapt its UI per turn.
 */
import { supabase } from "@/integrations/supabase/client";
import { throwIfCreditsExhausted } from "@/lib/friendly-errors";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";

export type TriageIntent = "chat" | "clarify" | "build";

export type TriageMode =
  | "chat"
  | "clarify"
  | "build"
  | "edit"
  | "fix"
  | "explain"
  | "redesign";

export type TriageMeta = {
  mode: TriageMode;
  confidence: number;
  language: string;
  audience_level: "non_technical" | "mixed" | "technical";
  scope: "tiny" | "small" | "medium" | "large";
  brief: string;
  unknowns: string[];
  suggestions: string[];
};

type Handlers = {
  onReplyDelta?: (delta: string) => void;
  onMeta?: (meta: TriageMeta) => void;
  onIntent?: (intent: TriageIntent) => void;
  onError?: (message: string) => void;
};

export type TriageResult = {
  reply: string;
  intent: TriageIntent;
  meta: TriageMeta | null;
};

const DEFAULT_META: TriageMeta = {
  mode: "build",
  confidence: 0.6,
  language: "en",
  audience_level: "non_technical",
  scope: "small",
  brief: "",
  unknowns: [],
  suggestions: [],
};

export async function streamTriage(
  body: {
    messages: ChatMessage[];
    currentFiles: ProjectFile[];
    customInstructions?: string;
    /** Lets the server load this project's memory and inject it into the
     *  triage prompt — so Petal feels like it remembers the project. */
    projectId?: string;
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
      return { reply: "", intent: "build", meta: null };
    }
    throw e;
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throwIfCreditsExhausted(resp, text);
    throw new Error(text || `Triage failed (${resp.status})`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  let intent: TriageIntent = "build";
  let meta: TriageMeta | null = null;

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
          | { type: "meta"; meta: TriageMeta }
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
        } else if (evt.type === "meta") {
          meta = { ...DEFAULT_META, ...evt.meta };
          handlers.onMeta?.(meta);
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
      return { reply, intent, meta };
    }
    throw e;
  }

  return { reply, intent, meta };
}
