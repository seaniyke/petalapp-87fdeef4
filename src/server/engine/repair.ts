/**
 * Bounded single-file repair for a generated file that failed to parse.
 * Rewrites ONLY that file; the caller re-verifies before accepting it.
 * Code-writing call: page-generation provider policy, thinking off.
 */
import type { ProjectFile } from "@/server/generate.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { isTruncationDetail } from "@/server/engine/build-state";
import { defaultTextModel } from "@/lib/ai-model-config";
import { InfrastructureFailure, classifyHttpStatus, classifyFailureOrigin } from "@/lib/failure-classification";

const SYSTEM =
  "You fix one source file that fails to compile. Return ONLY the complete corrected file contents — no markdown fences, no commentary. Keep the file's purpose, content, exports and imports; change only what is needed to fix the error.";

export function stripFences(s: string): string {
  return s.replace(/^\s*```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "");
}

/** Exported for tests: the exact repair prompt body. */
export function buildRepairUserMessage(file: ProjectFile, detail: string, turnContext: string | null): string {
  const ctx = turnContext?.trim()
    ? `${turnContext.trim()}\n\nRules: this file is the CURRENT authoritative version. Keep the approach already taken (same router, same imports, same structure) unless the error proves it wrong. Fix only the reported error; do not redesign, rename, or switch libraries.\n\n`
    : "";
  return `${ctx}Path: ${file.path}\nError: ${detail}\n\n${file.content}`;
}

export async function repairBrokenFile(
  file: ProjectFile,
  detail: string,
  meta?: {
    turnId?: string | null;
    projectId?: string | null;
    userId?: string | null;
    /**
     * Compact turn record (original request, scope, earlier attempts and why
     * they failed) plus the deterministic App Map. Lets this repair continue
     * the same piece of work instead of starting fresh from one error.
     */
    turnContext?: string | null;
  },
): Promise<string | null> {
  // A cut-off file is not repairable by patching half of it. The WRITE stage
  // re-requests truncated pages; anything still truncated here is isolated.
  if (isTruncationDetail(detail)) return null;
  // A provider failure is NOT evidence about this file. Throw a typed
  // infrastructure failure so the caller preserves the file instead of
  // treating "no repair" as "this file is invalid".
  let resp: Response;
  try {
    resp = await aiChatCompletions({
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
        { role: "user", content: buildRepairUserMessage(file, detail, meta?.turnContext ?? null) },
      ],
    },
  });
  } catch (e) {
    if (classifyFailureOrigin(e) === "cancelled") throw e;
    throw new InfrastructureFailure(e instanceof Error ? e.message : String(e));
  }
  if (!resp.ok) {
    if (classifyHttpStatus(resp.status) === "infrastructure") {
      throw new InfrastructureFailure(`repair provider returned HTTP ${resp.status}`, resp.status);
    }
    return null;
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const out = stripFences(data.choices?.[0]?.message?.content ?? "");
  return out.trim() ? out : null;
}
