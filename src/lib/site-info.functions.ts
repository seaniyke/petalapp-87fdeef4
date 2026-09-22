/**
 * AI authoring for a project's published "Website info".
 *
 * Kimble's build summaries are written to the user ("I've built the core of
 * your app…"), which is the wrong voice for a <meta description>. This server
 * function rewrites what was built into a real product title + description
 * that describes the APP, never the assistant's work.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  title: z.string().default(""),
  summary: z.string().default(""),
  prompt: z.string().default(""),
});

export const generateSiteInfo = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const { describeAppFallback } = await import("./site-info-copy");
    const fallback = {
      title: (data.title || "").slice(0, 60),
      description: describeAppFallback(data.summary || data.prompt || ""),
    };
    try {
      const { aiChatCompletions } = await import("@/server/ai-provider.server");
      const res = await aiChatCompletions({
        feature: "memory",
        body: {
          messages: [
            {
              role: "system",
              content:
                'You write SEO metadata for web apps. Reply with ONLY JSON: {"title": string, "description": string}. ' +
                "The title is the product name (2-5 words, title case, no punctuation at the end, max 60 chars). " +
                "The description describes what the APP does for its user, in third person, max 155 characters, one sentence, no marketing fluff. " +
                'NEVER write about the assistant or the build process (no "I built", "I\'ve created", "this project").',
            },
            {
              role: "user",
              content: `Current title: ${data.title.slice(0, 120)}\nOriginal request: ${data.prompt.slice(0, 400)}\nWhat the app contains: ${data.summary.slice(0, 900)}`,
            },
          ],
          max_tokens: 200,
          temperature: 0.5,
        },
      });
      if (!res.ok) return fallback;
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = json.choices?.[0]?.message?.content ?? "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return fallback;
      const parsed = JSON.parse(match[0]) as { title?: string; description?: string };
      const title = (parsed.title || fallback.title).replace(/["""]/g, "").trim().slice(0, 60);
      const description = (parsed.description || fallback.description)
        .replace(/["""]/g, "")
        .trim()
        .slice(0, 160);
      return { title: title || fallback.title, description: description || fallback.description };
    } catch {
      return fallback;
    }
  });

const IconInput = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
});

/** Builds the image prompt for a project favicon / app icon. */
export const generateSiteIconPrompt = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IconInput.parse(data))
  .handler(async ({ data }) => {
    const { iconPromptFor } = await import("./site-info-copy");
    return { prompt: iconPromptFor(data.title, data.description) };
  });
