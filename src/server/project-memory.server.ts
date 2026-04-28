/**
 * Per-project memory store.
 *
 * Petal saves a small set of stable facts about each project (audience,
 * tone, palette intent, must-haves, things to avoid, …) so it stops
 * starting from zero on every turn. Memory is loaded into the system
 * prompt of both /api/triage and /api/generate, and updated by a tiny
 * "memory writer" model after each successful build.
 *
 * Design choices:
 *
 * - Key/value rows (not a JSON blob) so individual facts can be added,
 *   updated or removed without rewriting the whole memory.
 * - Hard cap of MAX_KEYS keys per project. The writer is told to merge,
 *   not append, and we trim oldest-updated keys if the cap is exceeded.
 * - Every read AND every write goes through a Supabase client built from
 *   the user's JWT, so RLS policies on `project_memory` enforce ownership.
 *   No service-role keys here.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiChatCompletions } from "@/server/ai-provider.server";

const MAX_KEYS = 30;
const MAX_VALUE_LEN = 400;
const MAX_KEY_LEN = 60;

/** Suggested keys — the writer is told to prefer these, but free to invent more. */
export const SUGGESTED_KEYS = [
  "app_kind", // "barber-shop landing page", "habit tracker", …
  "audience", // who the app is for
  "tone", // playful / professional / minimal / luxe / …
  "palette_intent", // user's words about color / mood
  "typography_intent", // "serif", "rounded sans", etc.
  "key_features", // comma list of locked-in features
  "must_have", // hard requirements the user repeated
  "dont_do", // things they explicitly rejected
  "language", // ISO-ish tag (en, fr, pidgin) the user writes in
  "name", // app or business name if revealed
  "notes", // catch-all for anything that doesn't fit
];

export type MemoryEntry = { key: string; value: string };

function userClient(jwt: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase env not configured");
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Load all memory rows for a project. Returns [] on error so memory is
 *  always strictly additive — a DB hiccup must never block triage/build. */
export async function loadProjectMemory(
  jwt: string,
  projectId: string,
): Promise<MemoryEntry[]> {
  try {
    const supabase = userClient(jwt);
    const { data, error } = await supabase
      .from("project_memory")
      .select("key, value")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(MAX_KEYS);
    if (error) {
      console.warn("[project-memory] load failed:", error.message);
      return [];
    }
    return (data ?? []).map((r) => ({ key: r.key, value: r.value }));
  } catch (e) {
    console.warn("[project-memory] load threw:", e);
    return [];
  }
}

/** Render memory as a compact markdown block to inject into a system prompt.
 *  Returns "" when there is no memory yet so prompts stay clean for new projects. */
export function renderMemoryBlock(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries
    .filter((e) => e.key && e.value)
    .slice(0, MAX_KEYS)
    .map((e) => `- ${e.key}: ${e.value}`);
  if (lines.length === 0) return "";
  return (
    `\n\nProject Memory — what you already know about this project (always honor these unless the user contradicts them):\n` +
    lines.join("\n") +
    "\n"
  );
}

/** Convenience: load + render in one call. */
export async function loadProjectMemoryBlock(
  jwt: string,
  projectId: string,
): Promise<string> {
  const entries = await loadProjectMemory(jwt, projectId);
  return renderMemoryBlock(entries);
}

/** ──────────────────────────────────────────────────────────────────────
 *  Memory writer — runs AFTER a successful build.
 *
 *  Goal: cheaply distill the user's latest turn (+ existing memory) into a
 *  small set of merge instructions: upsert these keys, delete those keys.
 *  The writer is told to be conservative — if nothing notable changed,
 *  it returns an empty plan and we do nothing.
 *  ────────────────────────────────────────────────────────────────────── */

type MergePlan = {
  upserts: Array<{ key: string; value: string }>;
  deletes: string[];
};

const MEMORY_WRITER_SYSTEM = `You maintain a small, durable memory about a project the user is building with Petal (a friendly app builder).

You are given:
1. The CURRENT memory (a list of key/value facts).
2. The user's LATEST message and Petal's reply on this turn.
3. A list of SUGGESTED keys you should prefer when applicable.

Your job: return a SHORT merge plan via the "merge_memory" tool.

Rules:
- Only record STABLE facts about the project: who it's for, what it is, the mood/tone they want, hard requirements, things they've explicitly rejected.
- Do NOT record: greetings, temporary states, build statuses, file paths, frameworks, how Petal feels.
- Prefer the SUGGESTED keys. Invent a new key only when nothing in the suggested list fits.
- Each value MUST be a single short sentence (under 200 chars), in the user's own words where possible.
- If a key already exists and the user has REFINED or CONTRADICTED it, upsert the new value (overwrites).
- If the user explicitly rejected something previously stored ("stop using purple", "no carousel"), upsert a "dont_do" entry AND delete any contradicted key.
- If nothing notable changed, return empty arrays — do not invent facts.
- Never produce more than 6 upserts and 3 deletes per turn.

Be honest and conservative. An empty plan is a great answer.`;

const MERGE_TOOL = {
  type: "function" as const,
  function: {
    name: "merge_memory",
    description: "Return a small set of memory edits derived from this turn.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        upserts: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: { type: "string" },
              value: { type: "string" },
            },
            required: ["key", "value"],
          },
        },
        deletes: {
          type: "array",
          maxItems: 3,
          items: { type: "string" },
        },
      },
      required: ["upserts", "deletes"],
    },
  },
};

function sanitizeKey(k: string): string | null {
  const cleaned = k.trim().toLowerCase().replace(/\s+/g, "_").slice(0, MAX_KEY_LEN);
  return /^[a-z0-9][a-z0-9_-]*$/.test(cleaned) ? cleaned : null;
}

function sanitizeValue(v: string): string {
  return v.trim().replace(/\s+/g, " ").slice(0, MAX_VALUE_LEN);
}

/**
 * Run the memory writer for one turn. Best-effort — failures are logged
 * and swallowed so a memory hiccup never breaks the user's build.
 */
export async function updateProjectMemory(args: {
  jwt: string;
  projectId: string;
  userMessage: string;
  assistantSummary: string;
}): Promise<void> {
  const { jwt, projectId, userMessage, assistantSummary } = args;

  // Skip outright if there's nothing meaningful to learn from.
  const trimmedUser = (userMessage ?? "").trim();
  if (trimmedUser.length < 4) return;

  if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) return;

  let existing: MemoryEntry[] = [];
  try {
    existing = await loadProjectMemory(jwt, projectId);
  } catch {
    /* keep going with empty memory */
  }

  const existingBlock =
    existing.length === 0
      ? "(no memory yet)"
      : existing.map((e) => `- ${e.key}: ${e.value}`).join("\n");

  const userPrompt =
    `CURRENT MEMORY:\n${existingBlock}\n\n` +
    `SUGGESTED KEYS (prefer these): ${SUGGESTED_KEYS.join(", ")}\n\n` +
    `USER'S LATEST MESSAGE:\n"""${trimmedUser.slice(0, 2000)}"""\n\n` +
    `PETAL'S REPLY (one-line summary):\n"""${(assistantSummary ?? "").slice(0, 600)}"""\n\n` +
    `Return your merge plan now.`;

  let plan: MergePlan | null = null;
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: MEMORY_WRITER_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [MERGE_TOOL],
        tool_choice: { type: "function", function: { name: "merge_memory" } },
      }),
    });
    if (!resp.ok) {
      console.warn("[project-memory] writer http error", resp.status);
      return;
    }
    const json = (await resp.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{ function?: { arguments?: string } }>;
        };
      }>;
    };
    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return;
    plan = JSON.parse(argsStr) as MergePlan;
  } catch (e) {
    console.warn("[project-memory] writer threw:", e);
    return;
  }

  if (!plan) return;
  const upserts = Array.isArray(plan.upserts) ? plan.upserts : [];
  const deletes = Array.isArray(plan.deletes) ? plan.deletes : [];
  if (upserts.length === 0 && deletes.length === 0) return;

  // Apply with the user's JWT so RLS approves the writes.
  try {
    const supabase = userClient(jwt);

    const cleanUpserts = upserts
      .map((u) => {
        const key = sanitizeKey(u.key ?? "");
        const value = sanitizeValue(u.value ?? "");
        return key && value ? { project_id: projectId, key, value } : null;
      })
      .filter((x): x is { project_id: string; key: string; value: string } => x !== null);

    if (cleanUpserts.length > 0) {
      const { error } = await supabase
        .from("project_memory")
        .upsert(cleanUpserts, { onConflict: "project_id,key" });
      if (error) console.warn("[project-memory] upsert failed:", error.message);
    }

    const cleanDeletes = deletes
      .map((k) => sanitizeKey(k))
      .filter((k): k is string => !!k);
    if (cleanDeletes.length > 0) {
      const { error } = await supabase
        .from("project_memory")
        .delete()
        .eq("project_id", projectId)
        .in("key", cleanDeletes);
      if (error) console.warn("[project-memory] delete failed:", error.message);
    }

    // Enforce the cap: if we now exceed MAX_KEYS, trim the oldest-updated.
    const { data: all } = await supabase
      .from("project_memory")
      .select("id, updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    if (all && all.length > MAX_KEYS) {
      const toTrim = all.slice(MAX_KEYS).map((r) => r.id);
      if (toTrim.length > 0) {
        await supabase.from("project_memory").delete().in("id", toTrim);
      }
    }
  } catch (e) {
    console.warn("[project-memory] write threw:", e);
  }
}
