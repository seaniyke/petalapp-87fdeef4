/**
 * Generates a short, product-style project title from what Petal actually
 * built — never the raw user prompt. Used by the builder (auto-title) and by
 * the gallery reseed action.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  prompt: z.string().default(""),
  summary: z.string().default(""),
});

/** Last-resort title when the model is unavailable. */
export function fallbackTitle(prompt: string, summary: string): string {
  const source = (summary || prompt || "").replace(/https?:\/\/\S+/g, " ");
  // Prefer a quoted/branded name the summary mentions, e.g. called "Aura".
  const branded = source.match(/["“']([A-Z][\w& ]{2,30})["”']/);
  if (branded?.[1]) return branded[1].trim();
  const cleaned = source
    .replace(/^(i'?ve|i)\s+(created|built|scaffolded|set up|made)\s+/i, "")
    .replace(/^(create|build|make|design|generate)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 5).join(" ").replace(/[.,;:]+$/, "");
  const title = words || "Untitled project";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export const generateProjectTitle = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const fallback = fallbackTitle(data.prompt, data.summary);
    try {
      const { aiChatCompletions } = await import("@/server/ai-provider.server");
      const res = await aiChatCompletions({
        feature: "memory",
        body: {
          messages: [
            {
              role: "system",
              content:
                "You name software products. Given a build summary, reply with ONLY a short product name or title for the app: 2-4 words, title case, no quotes, no punctuation at the end, no URLs, never a sentence or an instruction. Examples: \"TradePathways Africa\", \"Aura Mood Tracker\", \"Cypher Crypto Terminal\".",
            },
            {
              role: "user",
              content: `Request: ${data.prompt.slice(0, 400)}\n\nWhat was built: ${data.summary.slice(0, 900)}`,
            },
          ],
          max_tokens: 24,
          temperature: 0.4,
        },
      });
      if (!res.ok) return fallback;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = json.choices?.[0]?.message?.content ?? "";
      const title = raw
        .replace(/https?:\/\/\S+/g, "")
        .replace(/["“”'`*]/g, "")
        .split("\n")[0]
        .trim()
        .replace(/[.:;,]+$/, "")
        .slice(0, 60);
      const wordCount = title.split(/\s+/).filter(Boolean).length;
      if (!title || wordCount > 7) return fallback;
      return title;
    } catch {
      return fallback;
    }
  });
