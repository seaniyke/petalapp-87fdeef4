/**
 * Synthesizes 2–4 short, tap-ready answer options for a Petal clarifying
 * question. Deterministic first (cheap), tiny LLM fallback when the question
 * is free-form (e.g. "What color scheme would you like?").
 *
 * The whole point: Petal must NEVER ask a question without giving the user
 * something to tap. If this returns [], the caller should still render the
 * question — but in practice the LLM fallback almost always yields options.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";

const MAX_OPTIONS = 4;
const MAX_OPTION_CHARS = 48;

function dedupeAndTrim(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const s = r
      .replace(/^[\s\-•*\d.)\]]+/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    if (!s) continue;
    if (s.length > MAX_OPTION_CHARS) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

function deterministicOptions(question: string): string[] {
  const q = question.trim();
  // "A, B, or C?" enumeration.
  const orMatch = q.match(
    /([^?.!,;:]+(?:,\s*[^?.!,;:]+)+\s*,?\s*or\s+[^?.!]+)\?/i,
  );
  if (orMatch) {
    const parts = orMatch[1]
      .split(/,\s*|\s+or\s+/i)
      .map((p) => p.replace(/^(?:the|a|an)\s+/i, "").trim())
      .filter((p) => p.length > 0 && p.length <= MAX_OPTION_CHARS);
    const cleaned = dedupeAndTrim(parts);
    if (cleaned.length >= 2) return cleaned;
  }
  // "either X or Y"
  const eitherMatch = q.match(/either\s+([^?.!]+?)\s+or\s+([^?.!]+)/i);
  if (eitherMatch) {
    const cleaned = dedupeAndTrim([eitherMatch[1], eitherMatch[2]]);
    if (cleaned.length >= 2) return cleaned;
  }
  // Yes/no auxiliary-verb opener.
  if (
    /^(?:is|are|was|were|do|does|did|can|could|should|would|will|have|has|had|may|might|shall)\b/i.test(
      q,
    )
  ) {
    return ["Yes", "No"];
  }
  return [];
}

async function llmOptions(
  question: string,
  context?: { lastUserMessage?: string },
): Promise<string[]> {
  if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return [];
  }
  const userMsg =
    `Petal (an AI builder) just asked the user this question:\n` +
    `"${question.trim()}"\n` +
    (context?.lastUserMessage
      ? `\nFor context, the user's previous message was:\n"${context.lastUserMessage.trim().slice(0, 400)}"\n`
      : "") +
    `\nReturn 3 short, distinct answer options the user could tap to reply, as a JSON array of strings. ` +
    `Each option ≤6 words, written in the user's voice (first person where natural, e.g. "Use a dark theme", "Keep it minimal"). ` +
    `No numbering, no quotes inside strings, no trailing punctuation. ` +
    `Respond with ONLY the JSON array.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await aiChatCompletions({
      feature: "triage",
      timeoutTier: "default",
      signal: ctrl.signal,
      body: {
        stream: false,
        temperature: 0.4,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content:
              "You generate short tap-to-reply answer chips for a builder assistant. Output ONLY a JSON array of 2–4 strings.",
          },
          { role: "user", content: userMsg },
        ],
      },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return [];
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];
    const parsed = JSON.parse(arrMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return dedupeAndTrim(
      parsed.filter((s): s is string => typeof s === "string"),
    );
  } catch {
    return [];
  }
}

/**
 * Best-effort: returns 2–4 short answer options for a question, or [] if even
 * the LLM fallback fails. Callers should still render the question — the chips
 * are an enhancement, not a hard requirement.
 */
export async function synthesizeAnswerOptions(
  question: string,
  context?: { lastUserMessage?: string },
): Promise<string[]> {
  const det = deterministicOptions(question);
  if (det.length >= 2) return det.slice(0, MAX_OPTIONS);
  const llm = await llmOptions(question, context);
  return llm.length >= 2 ? llm.slice(0, MAX_OPTIONS) : det;
}
