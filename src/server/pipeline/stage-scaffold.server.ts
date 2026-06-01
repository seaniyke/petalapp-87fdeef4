/**
 * Staged Pipeline — Stage 2: SCAFFOLD (parallel)
 *
 * Generates one file per AI call, in parallel, each call constrained to a
 * single file with a tight token budget. This eliminates the two failure
 * modes a monolithic write_project hits:
 *   - Output truncation (no single call ever fills the ceiling).
 *   - "All-or-nothing" failure (one file failing only re-runs that file).
 *
 * Per-file budget math:
 *   - Plan caps at 8 files; each gets max_tokens=2500 → ~20K tokens of
 *     parallel output peak. Cheap and well below ceilings.
 *   - On per-file failure we retry once with a smaller scope hint. If both
 *     attempts fail for a file, we record the failure and continue. The
 *     wire-up stage decides whether the partial set is usable.
 *
 * Failure surface kept honest:
 *   - We use Promise.allSettled — never let a rejected promise crash the
 *     stage.
 *   - tool_choice is forced; the model cannot reply in prose.
 *   - JSON parse errors and missing-content cases are caught per file.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import type { ProjectFile } from "@/server/generate.server";
import type { PlannedFile } from "./stage-plan.server";

export interface FileOutcome {
  path: string;
  ok: boolean;
  reason?: string;
}

export interface StageScaffoldResult {
  ok: true;
  files: ProjectFile[];
  outcomes: FileOutcome[];
}

export interface StageScaffoldFailure {
  ok: false;
  reason: string;
  outcomes: FileOutcome[];
}

const WRITE_FILE_TOOL = {
  type: "function" as const,
  function: {
    name: "write_file",
    description:
      "Emit the COMPLETE source for a single file. Do not include any other files. Do not include prose.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path of the file being written." },
        content: { type: "string", description: "The complete file contents." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
};

interface ScaffoldOneArgs {
  file: PlannedFile;
  brief: string;
  manifestSummary: string;
  /** Smaller line cap on retry to keep us well under the truncation cliff. */
  retryShrink?: boolean;
}

async function scaffoldOne(args: ScaffoldOneArgs): Promise<{ ok: true; file: ProjectFile } | { ok: false; reason: string }> {
  const { file, brief, manifestSummary, retryShrink } = args;
  const isRoot = file.path === "src/App.tsx";
  // Root view is too important to shrink on retry — losing App.tsx ships
  // the placeholder, which is worse than the truncation risk.
  const effectiveShrink = retryShrink && !isRoot;
  const lineCap = effectiveShrink ? Math.min(120, file.est_lines) : Math.min(220, file.est_lines + 40);
  const tokenCap = effectiveShrink ? 1800 : isRoot ? 3200 : 2500;

  const rootRules = isRoot
    ? `\nTHIS IS THE ROOT VIEW (src/App.tsx). Extra rules:\n` +
      `- Must contain REAL domain UI matching the brief — header, primary content area showing the actual feature, and any nav.\n` +
      `- NEVER return a "coming soon", "placeholder", "is being prepared", or "ask Petal to retry" card. That is a bug, not a valid output.\n` +
      `- Import and use the components listed in deps so the screen actually renders content.\n` +
      `- Default export must be \`function App\` returning visible JSX.`
    : "";

  try {
    const upstream = await aiChatCompletions({
      feature: "generate",
      body: {
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              `You write ONE file at a time for a Vite + React + TypeScript app using Tailwind v4 and the bundled shadcn UI kit at "@/components/ui/*". ` +
              `Always call write_file — never reply in prose. ` +
              `Hard cap: ${lineCap} lines for this file. Stay well under it. ` +
              `Use semantic tokens (bg-background, text-foreground, bg-primary, etc.) — never raw colors. ` +
              `Use kit primitives (Button, Card, Input, etc.) — never raw <button>, <input>, hand-rolled cards. ` +
              `Import only files that exist either in the manifest below or in the standard scaffold (src/components/ui/*, src/lib/utils, src/integrations/backend/*).` +
              rootRules,
          },
          {
            role: "user",
            content:
              `App brief: ${brief}\n\n` +
              `Project plan: ${manifestSummary}\n\n` +
              `Write THIS file only:\n` +
              `  path: ${file.path}\n` +
              `  purpose: ${file.purpose}\n` +
              `  depends on: ${file.deps.join(", ") || "(none)"}\n` +
              `  est lines: ${file.est_lines}\n`,
          },
        ],
        tools: [WRITE_FILE_TOOL],
        tool_choice: { type: "function", function: { name: "write_file" } },
        max_tokens: tokenCap,
        stream: false,
      },
      timeoutTier: "default",
      meta: { phase: "implement", promptChars: brief.length },
    });

    if (!upstream.ok) return { ok: false, reason: `upstream_${upstream.status}` };

    const json = (await upstream.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length") {
      return { ok: false, reason: "truncated" };
    }
    const argsStr = choice?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { ok: false, reason: "no_tool_call" };

    const parsed = JSON.parse(argsStr) as { path?: string; content?: string };
    if (!parsed.content || parsed.content.length < 10) {
      return { ok: false, reason: "empty_content" };
    }

    // Honor the planned path even if the model echoed a different one.
    return { ok: true, file: { path: file.path, content: parsed.content } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "scaffold_threw" };
  }
}

export async function runStageScaffold(args: {
  plan: PlannedFile[];
  brief: string;
  manifestSummary: string;
}): Promise<StageScaffoldResult | StageScaffoldFailure> {
  // Fire all files in parallel. allSettled means one rejected promise
  // never aborts the others — we collect every outcome.
  const results = await Promise.allSettled(
    args.plan.map((file) =>
      scaffoldOne({ file, brief: args.brief, manifestSummary: args.manifestSummary }),
    ),
  );

  const files: ProjectFile[] = [];
  const outcomes: FileOutcome[] = [];
  const retryQueue: PlannedFile[] = [];

  results.forEach((res, i) => {
    const planned = args.plan[i];
    if (res.status === "fulfilled" && res.value.ok) {
      files.push(res.value.file);
      outcomes.push({ path: planned.path, ok: true });
    } else {
      const reason =
        res.status === "fulfilled"
          ? (res.value as { ok: false; reason: string }).reason
          : (res.reason as Error)?.message ?? "rejected";
      retryQueue.push(planned);
      outcomes.push({ path: planned.path, ok: false, reason: `first:${reason}` });
    }
  });

  // Retry only the failures, with a smaller scope hint to dodge truncation.
  if (retryQueue.length) {
    const retried = await Promise.allSettled(
      retryQueue.map((file) =>
        scaffoldOne({
          file,
          brief: args.brief,
          manifestSummary: args.manifestSummary,
          retryShrink: true,
        }),
      ),
    );
    retried.forEach((res, i) => {
      const planned = retryQueue[i];
      const outcomeIdx = outcomes.findIndex((o) => o.path === planned.path);
      if (res.status === "fulfilled" && res.value.ok) {
        files.push(res.value.file);
        if (outcomeIdx >= 0) outcomes[outcomeIdx] = { path: planned.path, ok: true, reason: "retried" };
      } else {
        const reason =
          res.status === "fulfilled"
            ? (res.value as { ok: false; reason: string }).reason
            : (res.reason as Error)?.message ?? "rejected";
        if (outcomeIdx >= 0) {
          outcomes[outcomeIdx] = {
            path: planned.path,
            ok: false,
            reason: `${outcomes[outcomeIdx].reason} | retry:${reason}`,
          };
        }
      }
    });
  }

  // Stage succeeds if AT LEAST one file came back. Wire-up decides
  // whether the partial set is usable; a totally empty result fails.
  if (files.length === 0) {
    return { ok: false, reason: "all_files_failed", outcomes };
  }

  return { ok: true, files, outcomes };
}
