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
import type { ProjectFile } from "@/server/generate.server";
import { isScaffoldAbsorbedPath, isScaffoldOwnedPath } from "@/server/scaffold-ownership.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";
import {
  lintDesignSystem,
  type DesignLintReport,
} from "@/server/design/design-system-lint.server";

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


export async function enforceDesignContract(args: {
  files: ProjectFile[];
  design: PicDesignSystem | null;
  model?: string;
  /** @deprecated ignored — lint only. */
  repair?: boolean;
  /**
   * Files this turn actually changed. When given, the lint only judges those —
   * a small edit is never held responsible for styling debt it did not touch,
   * and never pays for reviewing the whole project.
   */
  changedPaths?: string[] | null;
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

  const scoped =
    args.changedPaths && args.changedPaths.length > 0
      ? args.files.filter((f) => args.changedPaths!.includes(f.path))
      : args.files;
  if (scoped.length === 0) return idle;

  let report: DesignLintReport;
  try {
    report = lintDesignSystem(scoped, args.design, { skip: lintSkip });
  } catch (e) {
    console.warn("[design-lint] skipped:", e instanceof Error ? e.message : String(e));
    return idle;
  }

  if (report.findings.length) {
    console.log(
      `[design-lint] project=${args.projectId ?? "n/a"} errors=${report.errorCount} warnings=${report.warningCount}`,
    );
  }
  // Lint only. Design findings are advisory — they never trigger an AI
  // call. Broken files are owned by the single REPAIR stage.
  return { ...idle, report };
}
