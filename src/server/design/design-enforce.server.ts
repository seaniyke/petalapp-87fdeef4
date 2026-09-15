/**
 * Design contract enforcement — the missing half of Phase 2.
 *
 * `design-system.server.ts` commits a design system per project and
 * `design-system-lint.server.ts` can check emitted code against it, but until
 * now nothing called the lint during a real build: the contract was decided,
 * handed to the model, and never verified.
 *
 * This module closes that loop. It lints the files a turn is about to ship
 * and, when the model broke the contract in a way a focused pass can fix,
 * makes ONE cheap model call limited to the offending files.
 *
 * Hard rules:
 *  - Never throws. A lint failure is a missing opinion, not a build failure.
 *  - Never touches scaffold-owned paths (the kit authors those, not the model).
 *  - Reports warnings; only *errors* (raw colours, hex values, missing tokens)
 *    are worth spending a model call on.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  PATCH_FILES_TOOL,
  applyOpsPartial,
  type FileOp,
  type ProjectFile,
} from "@/server/generate.server";
import { isScaffoldAbsorbedPath, isScaffoldOwnedPath } from "@/server/scaffold-ownership.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";
import {
  lintDesignSystem,
  renderDesignLintFeedback,
  type DesignLintReport,
} from "@/server/design/design-system-lint.server";

const SYSTEM = `You are fixing design-system violations in a React + Tailwind app.
The project has ONE committed design system. Every colour must come from its semantic tokens
(bg-background, text-foreground, bg-primary, text-muted-foreground, border-border, …), never from
raw Tailwind palette utilities (bg-white, text-gray-500, bg-blue-600) or hardcoded hex values.

Rules:
- Fix ONLY the listed violations. Change nothing else — no refactors, no copy edits, no new features.
- Replace each raw colour with the closest semantic token. Keep the visual intent
  (a light surface becomes bg-card or bg-muted, body copy becomes text-muted-foreground, etc.).
- Never delete a file. Never introduce new raw colours or hex values.
- Return the edits through the patch_files tool.`;

/** Files the model authored this turn — the only ones worth linting. */
function lintSkip(path: string): boolean {
  return isScaffoldOwnedPath(path) || isScaffoldAbsorbedPath(path) || /(^|\/)node_modules\//.test(path);
}

export interface DesignEnforceResult {
  /** The files after any repair pass (unchanged when nothing ran). */
  files: ProjectFile[];
  /** Lint report BEFORE the repair pass. */
  report: DesignLintReport;
  /** Lint report AFTER the repair pass, when one ran. */
  after: DesignLintReport | null;
  /** True when a model pass actually applied edits. */
  repaired: boolean;
  /** Paths the repair pass rewrote. */
  repairedPaths: string[];
}

/** Max files we will hand to the focused repair call. */
const MAX_REPAIR_FILES = 8;
const MAX_FILE_CHARS = 60_000;

export async function enforceDesignContract(args: {
  files: ProjectFile[];
  design: PicDesignSystem | null;
  model: string;
  /** Small cosmetic edits lint-and-log; structural turns lint-and-repair. */
  repair: boolean;
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<DesignEnforceResult> {
  const idle: DesignEnforceResult = {
    files: args.files,
    report: { findings: [], errorCount: 0, warningCount: 0, ok: true },
    after: null,
    repaired: false,
    repairedPaths: [],
  };
  if (!args.design) return idle;

  let report: DesignLintReport;
  try {
    report = lintDesignSystem(args.files, args.design, { skip: lintSkip });
  } catch (e) {
    console.warn("[design-lint] skipped:", e instanceof Error ? e.message : String(e));
    return idle;
  }

  if (report.findings.length) {
    console.log(
      `[design-lint] project=${args.projectId ?? "n/a"} errors=${report.errorCount} warnings=${report.warningCount}`,
    );
  }
  if (!args.repair || report.errorCount === 0) return { ...idle, report };

  // Only the files that actually carry an error, biggest offenders first.
  const offending = Array.from(
    new Set(report.findings.filter((f) => f.severity === "error").map((f) => f.path)),
  );
  const candidates = args.files
    .filter((f) => offending.includes(f.path) && f.content.length < MAX_FILE_CHARS)
    .slice(0, MAX_REPAIR_FILES);
  if (candidates.length === 0) return { ...idle, report };

  const feedback = renderDesignLintFeedback(report);

  try {
    const res = await aiChatCompletions({
      feature: "generate",
      timeoutTier: "default",
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "design-contract",
      },
      body: {
        model: args.model,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `${feedback}\n\n` +
              `Files:\n\n${candidates.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`,
          },
        ],
        tools: [PATCH_FILES_TOOL],
        tool_choice: { type: "function", function: { name: "patch_files" } },
        max_tokens: 8000,
        stream: false,
      },
    });
    if (!res.ok) return { ...idle, report };
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const rawArgs = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) return { ...idle, report };
    const parsed = JSON.parse(rawArgs) as { ops?: FileOp[] };
    const allowed = new Set(candidates.map((f) => f.path));
    const ops = (parsed.ops ?? []).filter((op) => op && allowed.has(op.path) && op.op !== "delete");
    if (ops.length === 0) return { ...idle, report };

    const applied = applyOpsPartial(args.files, ops);
    const repairedPaths = Array.from(new Set(applied.applied.map((o) => o.path)));
    if (repairedPaths.length === 0) return { ...idle, report };

    const after = lintDesignSystem(applied.files, args.design, { skip: lintSkip });
    console.log(
      `[design-lint] repaired paths=${repairedPaths.length} errors ${report.errorCount} -> ${after.errorCount}`,
    );
    return { files: applied.files, report, after, repaired: true, repairedPaths };
  } catch (e) {
    console.warn("[design-lint] repair failed:", e instanceof Error ? e.message : String(e));
    return { ...idle, report };
  }
}
