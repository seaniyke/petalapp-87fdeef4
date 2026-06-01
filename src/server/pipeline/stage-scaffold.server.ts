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
 *   - Plan caps at 10 files; each gets ~2500 tokens (root view 3200) →
 *     parallel output peak well below ceilings.
 *   - Each generated file is parser-validated before we accept it. On
 *     parse failure we re-emit the WHOLE file with the previous attempt +
 *     parser error in the user prompt (FULL token budget — never shrink,
 *     shrinking is what caused the truncation cliff for medium files).
 *   - Token-cap truncation also triggers a full re-emit retry.
 *   - If both attempts fail with `syntax_error`, the scaffold returns
 *     ok:false reason:"scaffold_syntax_unrecoverable" so the orchestrator
 *     can silently fall back to the monolithic path (same pattern as
 *     missing_root_view).
 *
 * Quality inputs (Phase 1 + 3 of the staged-pipeline rebuild):
 *   - context.designSummary — short rendered summary of the committed
 *     design direction (vibe + palette + typography). Threaded into every
 *     file's system prompt so each component is built to the same look.
 *
 * Failure surface kept honest:
 *   - Promise.allSettled — never let a rejected promise crash the stage.
 *   - tool_choice is forced; the model cannot reply in prose.
 *   - JSON parse errors and missing-content cases are caught per file.
 */

import { parse as babelParse } from "@babel/parser";
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
  /** Files that failed parse on BOTH attempts. Non-empty = wire-up should fall back. */
  syntaxUnrecoverable: string[];
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

/**
 * Quick syntactic validation via @babel/parser. We only care whether the
 * file PARSES — type checking is downstream. Returns `null` on success,
 * a short error message on failure. Skipped for non-TS/JS extensions
 * (the planner never plans those, but be defensive).
 */
function validateFileSyntax(path: string, content: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return null;
  try {
    babelParse(content, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: ["typescript", "jsx", "decorators-legacy", "topLevelAwait"],
    });
    return null;
  } catch (e) {
    if (e && typeof e === "object" && "message" in e) {
      const msg = String((e as { message?: unknown }).message ?? "parse failed");
      // Babel error messages look like "Unexpected token (12:5)". Keep
      // the original — the position helps the retry prompt.
      return msg.slice(0, 240);
    }
    return "parse failed";
  }
}

interface ScaffoldOneArgs {
  file: PlannedFile;
  brief: string;
  manifestSummary: string;
  designSummary?: string;
  /**
   * Previous failed attempt — passed into a retry so the model can see
   * its mistake. When set, we use the FULL token budget (no shrink) and
   * include the parser error in the user prompt.
   */
  previousAttempt?: { content: string; parserError: string };
}

async function scaffoldOne(
  args: ScaffoldOneArgs,
): Promise<{ ok: true; file: ProjectFile } | { ok: false; reason: string; lastContent?: string }> {
  const { file, brief, manifestSummary, designSummary, previousAttempt } = args;
  const isRoot = file.path === "src/App.tsx";
  // Full budget on every call. The recent "don't shrink the root view"
  // rule is now generalized to every file — shrinking caused most of the
  // mid-file truncations we used to blame on the model.
  const lineCap = Math.min(240, file.est_lines + 60);
  const tokenCap = isRoot ? 3200 : 2800;

  const rootRules = isRoot
    ? `\nTHIS IS THE ROOT VIEW (src/App.tsx). Extra rules:\n` +
      `- Must contain REAL domain UI matching the brief — header, primary content area showing the actual feature, and any nav.\n` +
      `- NEVER return a "coming soon", "placeholder", "is being prepared", or "ask Petal to retry" card. That is a bug, not a valid output.\n` +
      `- Import and use the components listed in deps so the screen actually renders content.\n` +
      `- Default export must be \`function App\` returning visible JSX.`
    : "";

  const designLine = designSummary
    ? `\nDesign direction (committed for this build): ${designSummary}. Use these tokens and typography choices, not generic shadcn defaults.`
    : "";

  const systemContent =
    `You write ONE file at a time for a Vite + React + TypeScript app using Tailwind v4 and the bundled shadcn UI kit at "@/components/ui/*". ` +
    `Always call write_file — never reply in prose. ` +
    `Hard cap: ${lineCap} lines for this file. Stay well under it. ` +
    `Your output MUST be syntactically valid TS/TSX — balanced parens/braces, every JSX tag closed, every import on its own line, no half-written expressions. ` +
    `Use semantic tokens (bg-background, text-foreground, bg-primary, etc.) — never raw colors. ` +
    `Use kit primitives (Button, Card, Input, etc.) — never raw <button>, <input>, hand-rolled cards. ` +
    `Import only files that exist either in the manifest below or in the standard scaffold (src/components/ui/*, src/lib/utils, src/integrations/backend/*).` +
    designLine +
    rootRules;

  const retryBlock = previousAttempt
    ? `\n\nPREVIOUS ATTEMPT FAILED to parse with: ${previousAttempt.parserError}\nDo not repeat the same mistake. Re-emit the COMPLETE file (not a diff) with the syntax fixed. Your previous attempt began:\n\n${previousAttempt.content.slice(0, 600)}…`
    : "";

  try {
    const upstream = await aiChatCompletions({
      feature: "generate",
      body: {
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemContent },
          {
            role: "user",
            content:
              `App brief: ${brief}\n\n` +
              `Project plan: ${manifestSummary}\n\n` +
              `Write THIS file only:\n` +
              `  path: ${file.path}\n` +
              `  purpose: ${file.purpose}\n` +
              `  depends on: ${file.deps.join(", ") || "(none)"}\n` +
              `  est lines: ${file.est_lines}\n` +
              retryBlock,
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

    // Parser gate. We only accept files that parse cleanly — otherwise
    // they'll blow up in the bundler or at render and the user will see
    // the autofix-narrating-its-fix chat leak we just removed.
    const parseError = validateFileSyntax(file.path, parsed.content);
    if (parseError) {
      return { ok: false, reason: `syntax_error:${parseError}`, lastContent: parsed.content };
    }

    // Honor the planned path even if the model echoed a different one.
    return { ok: true, file: { path: file.path, content: parsed.content } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "scaffold_threw" };
  }
}

interface ScaffoldContext {
  /** Compact one-line rendering of the design direction. */
  designSummary?: string;
}

export async function runStageScaffold(args: {
  plan: PlannedFile[];
  brief: string;
  manifestSummary: string;
  context?: ScaffoldContext;
}): Promise<StageScaffoldResult | StageScaffoldFailure> {
  const designSummary = args.context?.designSummary;
  // Fire all files in parallel. allSettled means one rejected promise
  // never aborts the others — we collect every outcome.
  const firstPass = await Promise.allSettled(
    args.plan.map((file) =>
      scaffoldOne({ file, brief: args.brief, manifestSummary: args.manifestSummary, designSummary }),
    ),
  );

  const files: ProjectFile[] = [];
  const outcomes: FileOutcome[] = [];
  interface RetryItem {
    file: PlannedFile;
    previousAttempt?: { content: string; parserError: string };
  }
  const retryQueue: RetryItem[] = [];

  firstPass.forEach((res, i) => {
    const planned = args.plan[i];
    if (res.status === "fulfilled" && res.value.ok) {
      files.push(res.value.file);
      outcomes.push({ path: planned.path, ok: true });
      return;
    }
    const reason =
      res.status === "fulfilled"
        ? (res.value as { ok: false; reason: string }).reason
        : (res.reason as Error)?.message ?? "rejected";
    const lastContent =
      res.status === "fulfilled"
        ? (res.value as { ok: false; reason: string; lastContent?: string }).lastContent
        : undefined;
    // Build retry context: only feed previous attempt back when it was a
    // syntax error — for upstream/truncation failures the previous content
    // is useless or absent.
    const isSyntax = reason.startsWith("syntax_error:");
    retryQueue.push({
      file: planned,
      previousAttempt:
        isSyntax && lastContent
          ? { content: lastContent, parserError: reason.slice("syntax_error:".length) }
          : undefined,
    });
    outcomes.push({ path: planned.path, ok: false, reason: `first:${reason}` });
  });

  const syntaxUnrecoverable: string[] = [];

  if (retryQueue.length) {
    const retried = await Promise.allSettled(
      retryQueue.map((item) =>
        scaffoldOne({
          file: item.file,
          brief: args.brief,
          manifestSummary: args.manifestSummary,
          designSummary,
          previousAttempt: item.previousAttempt,
        }),
      ),
    );
    retried.forEach((res, i) => {
      const planned = retryQueue[i].file;
      const outcomeIdx = outcomes.findIndex((o) => o.path === planned.path);
      if (res.status === "fulfilled" && res.value.ok) {
        files.push(res.value.file);
        if (outcomeIdx >= 0) outcomes[outcomeIdx] = { path: planned.path, ok: true, reason: "retried" };
        return;
      }
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
      // Track syntax-unrecoverable separately so the orchestrator can
      // decide to fall back to the monolithic path.
      const firstWasSyntax = (outcomes[outcomeIdx]?.reason ?? "").includes("first:syntax_error");
      const retryWasSyntax = reason.startsWith("syntax_error:");
      if (firstWasSyntax && retryWasSyntax) {
        syntaxUnrecoverable.push(planned.path);
      }
    });
  }

  // Stage succeeds if AT LEAST one file came back. Wire-up decides
  // whether the partial set is usable; a totally empty result fails.
  if (files.length === 0) {
    return { ok: false, reason: "all_files_failed", outcomes };
  }

  return { ok: true, files, outcomes, syntaxUnrecoverable };
}
