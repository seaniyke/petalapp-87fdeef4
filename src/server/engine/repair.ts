/**
 * Bounded single-file repair for a generated file that failed to parse.
 * Rewrites ONLY that file; the caller re-verifies before accepting it.
 * Code-writing call: page-generation provider policy, thinking off.
 */
import type { ProjectFile } from "@/server/generate.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { defaultTextModel } from "@/lib/ai-model-config";

const SYSTEM =
  "You fix one source file that fails to compile. Return ONLY the complete corrected file contents — no markdown fences, no commentary. Keep the file's purpose, content, exports and imports; change only what is needed to fix the error.";

export function stripFences(s: string): string {
  return s.replace(/^\s*```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "");
}

export async function repairBrokenFile(
  file: ProjectFile,
  detail: string,
  meta?: { turnId?: string | null; projectId?: string | null; userId?: string | null },
): Promise<string | null> {
  const resp = await aiChatCompletions({
    feature: "recovery",
    codeOutput: true,
    lockCallerModel: true,
    noFallback: true,
    timeoutTier: "default",
    meta: {
      chosenBy: "broken_file_repair",
      recoveryReason: "parse_error",
      turnId: meta?.turnId ?? null,
      projectId: meta?.projectId ?? null,
      userId: meta?.userId ?? null,
    },
    body: {
      model: defaultTextModel(),
      reasoning: { enabled: false },
      max_tokens: Math.min(12_000, Math.max(3_000, Math.ceil(file.content.length / 2.5))),
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Path: ${file.path}\nError: ${detail}\n\n${file.content}` },
      ],
    },
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const out = stripFences(data.choices?.[0]?.message?.content ?? "");
  return out.trim() ? out : null;
}
