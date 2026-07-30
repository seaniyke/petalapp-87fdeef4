/**
 * Readiness badge — small chip in the builder header showing the project's
 * current production-readiness level + score, with a popover checklist.
 *
 * Reuses Petal Shield's analyzer so we don't double-scan.
 */
import { useMemo, useState } from "react";
import { Check, Rocket, Wand2, Globe } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { analyzeProject } from "@/lib/petal-shield";
import {
  evaluateReadiness,
  LEVEL_LABEL,
  READINESS_FIXES,
  type ReadinessCheck,
} from "@/lib/readiness";
import type { ProjectFile } from "@/server/generate.server";
import type { ProjectRow } from "@/lib/projects";

const LEVEL_STYLES = {
  prototype:
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  beta: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  production:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
} as const;

const CATEGORY_ORDER: ReadinessCheck["category"][] = [
  "security",
  "infra",
  "polish",
  "growth",
];

const CATEGORY_LABEL: Record<ReadinessCheck["category"], string> = {
  security: "Security",
  infra: "Infrastructure",
  polish: "User experience",
  growth: "Growth",
};

export type ReadinessBadgeProps = {
  files: ProjectFile[];
  project: ProjectRow | null;
  /** Runs a build prompt for a checklist item the user wants Petal to fix. */
  onFix?: (prompt: string) => void;
  /** Opens the custom-domain flow. */
  onConnectDomain?: () => void;
};

export function ReadinessBadge({
  files,
  project,
  onFix,
  onConnectDomain,
}: ReadinessBadgeProps) {
  const [open, setOpen] = useState(false);

  const report = useMemo(() => {
    if (!files.length) return null;
    const shield = analyzeProject(files);
    return evaluateReadiness(files, project, shield);
  }, [files, project]);

  if (!report) return null;

  // Unfinished work first — the whole point is "what do I do next".
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: report.checks
      .filter((c) => c.category === cat)
      .sort((a, b) => Number(a.passed) - Number(b.passed)),
  })).filter((g) => g.items.length);

  const remaining = report.totalChecks - report.passedCount;

  const runFix = (check: ReadinessCheck) => {
    const fix = READINESS_FIXES[check.id];
    if (!fix) return;
    setOpen(false);
    if (fix.kind === "domain") onConnectDomain?.();
    else onFix?.(fix.prompt);
  };


  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "hidden h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition hover:opacity-80 md:inline-flex",
            LEVEL_STYLES[report.level],
          )}
          title="Launch checklist"
        >
          <Rocket className="h-3.5 w-3.5" />
          <span>
            {report.level === "production"
              ? "Launch ready"
              : remaining === 1
                ? "1 step to launch"
                : `${remaining} steps to launch`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Launch checklist
              </div>
              <div className="mt-0.5 text-lg font-semibold">
                {report.level === "production"
                  ? "You're launch ready 🎉"
                  : remaining === 1
                    ? "1 step to go"
                    : `${remaining} steps to go`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tabular-nums">
                {report.passedCount}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                / {report.totalChecks} done
              </div>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full transition-all",
                report.level === "production"
                  ? "bg-emerald-500"
                  : report.level === "beta"
                    ? "bg-sky-500"
                    : "bg-amber-500",
              )}
              style={{ width: `${report.score}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {LEVEL_LABEL[report.level]} · knock these out whenever you're ready.
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {grouped.map(({ cat, items }) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABEL[cat]}
              </div>
              <ul className="space-y-0.5">
                {items.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                        c.passed
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {c.passed ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "font-medium leading-tight",
                          !c.passed && "text-foreground",
                        )}
                      >
                        {c.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {c.detail}
                      </div>
                    </div>
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
