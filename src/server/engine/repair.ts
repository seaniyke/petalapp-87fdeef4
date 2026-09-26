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

const PATCH_SYSTEM =
  "You fix one source file that fails to compile by returning ONLY search/replace edits, never the whole file. " +
  "Format each edit exactly as:\n<<<<<<< SEARCH\n(exact lines copied from the file)\n=======\n(replacement lines)\n>>>>>>> REPLACE\n" +
  "SEARCH text must match the file exactly and be unique. Change only what fixes the error; keep purpose, exports and imports.";

/**
 * Apply search/replace edits. Returns null unless EVERY edit matches exactly
 * once — a partial patch is never accepted (caller falls back to whole-file).
 */
export function applyPatches(content: string, reply: string): string | null {
  const re = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;
  let out = content;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    const search = m[1]!;
    if (!search.trim()) return null;
    const first = out.indexOf(search);
    if (first < 0 || out.indexOf(search, first + 1) >= 0) return null;
    out = out.slice(0, first) + m[2]! + out.slice(first + search.length);
    n++;
  }
  return n > 0 && out !== content ? out : null;
}

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
  // Hierarchy: targeted patch first (small output, touches only the broken
  // lines), whole-file rewrite only when the patch doesn't apply cleanly.
  const user = buildRepairUserMessage(file, detail, meta?.turnContext ?? null);
  const patchReply = await callRepair(PATCH_SYSTEM, user, 3_000, "targeted_patch", meta);
  const patched = patchReply ? applyPatches(file.content, patchReply) : null;
  if (patched) return patched;
  const whole = await callRepair(SYSTEM, user, Math.min(12_000, Math.max(3_000, Math.ceil(file.content.length / 2.5))), "whole_file", meta);
  const out = whole ? stripFences(whole) : "";
  return out.trim() ? out : null;
}

async function callRepair(
  system: string,
  user: string,
  maxTokens: number,
  mode: "targeted_patch" | "whole_file",
  meta?: { turnId?: string | null; projectId?: string | null; userId?: string | null },
): Promise<string | null> {
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
      chosenBy: mode === "targeted_patch" ? "broken_file_repair_patch" : "broken_file_repair",
      recoveryReason: "parse_error",
      turnId: meta?.turnId ?? null,
      projectId: meta?.projectId ?? null,
      userId: meta?.userId ?? null,
    },
    body: {
      model: defaultTextModel(),
      reasoning: { enabled: false },
      max_tokens: maxTokens,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
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
  return data.choices?.[0]?.message?.content ?? null;
}
