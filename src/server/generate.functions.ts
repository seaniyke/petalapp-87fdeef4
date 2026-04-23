import { createServerFn } from "@tanstack/react-start";
import {
  SYSTEM_PROMPT,
  WRITE_PROJECT_TOOL,
  type ChatMessage,
  type GenerateResult,
  type ProjectFile,
} from "./generate.server";

type Input = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
};

export const generateProject = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => {
    if (!input || !Array.isArray(input.messages)) {
      throw new Error("messages must be an array");
    }
    return {
      messages: input.messages.slice(-20),
      currentFiles: Array.isArray(input.currentFiles) ? input.currentFiles : [],
    };
  })
  .handler(async ({ data }): Promise<GenerateResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const filesContext =
      data.currentFiles.length > 0
        ? `\n\nThe user already has this project. Update it as requested and return the FULL updated project.\n\n${data.currentFiles
            .map((f) => `--- ${f.path} ---\n${f.content}`)
            .join("\n\n")}`
        : "\n\nThere is no existing project yet. Create one from scratch.";

    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT + filesContext },
      ...data.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: chatMessages,
        tools: [WRITE_PROJECT_TOOL],
        tool_choice: { type: "function", function: { name: "write_project" } },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        throw new Error("Rate limit reached. Please wait a moment and try again.");
      }
      if (resp.status === 402) {
        throw new Error(
          "AI credits exhausted. Add credits in Settings → Workspace → Usage."
        );
      }
      const text = await resp.text();
      console.error("AI gateway error", resp.status, text);
      throw new Error(`AI gateway error (${resp.status})`);
    }

    const json = await resp.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return a project. Try rephrasing your request.");
    }

    let parsed: GenerateResult;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool call", e, toolCall.function.arguments);
      throw new Error("AI returned invalid project data.");
    }

    if (!parsed.files?.length || !parsed.files.some((f) => f.path === "index.html")) {
      throw new Error("AI did not include an index.html file.");
    }

    return parsed;
  });
