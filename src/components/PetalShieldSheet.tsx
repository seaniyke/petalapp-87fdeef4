/**
 * Petal Shield UI — security audit panel triggered from the builder header.
 *
 * Shows the Shield Score (A–F), groups findings by severity, and lets the user
 * copy a fix-it prompt straight into the composer. No backend dependency —
 * the analyzer runs client-side over the in-memory ProjectFile[].
 */
import { useMemo, useState } from "react";
import { Shield, ShieldAlert, ShieldCheck, ChevronRight, Copy, Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  analyzeProject,
  SEVERITY_LABEL,
  type ShieldFinding,
  type ShieldSeverity,
} from "@/lib/petal-shield";
import type { ProjectFile } from "@/server/generate.server";
import { cn } from "@/lib/utils";

const SEVERITY_ORDER: ShieldSeverity[] = ["critical", "high", "medium", "low"];

const SEVERITY_STYLES: Record<ShieldSeverity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  medium: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  low: "bg-muted text-muted-foreground border-border",
};

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  B: "text-emerald-600 dark:text-emerald-400",
  C: "text-amber-600 dark:text-amber-400",
  D: "text-orange-600 dark:text-orange-400",
  F: "text-destructive",
};

export type PetalShieldSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: ProjectFile[];
  onSendFixPrompt?: (prompt: string) => void;
};

export function PetalShieldSheet({
  open,
  onOpenChange,
  files,
  onSendFixPrompt,
}: PetalShieldSheetProps) {
  const report = useMemo(() => (open ? analyzeProject(files) : null), [open, files]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!report) return {} as Record<ShieldSeverity, ShieldFinding[]>;
    const out: Record<ShieldSeverity, ShieldFinding[]> = {
      critical: [], high: [], medium: [], low: [],
    };
    for (const f of report.findings) out[f.severity].push(f);
    return out;
  }, [report]);

  function buildFixPrompt(f: ShieldFinding) {
    return `Fix Petal Shield finding: ${f.title}\n\nFile: ${f.file}${f.line ? `:${f.line}` : ""}\n${f.snippet ? `Snippet: ${f.snippet}\n` : ""}How: ${f.fix}`;
  }

  function copy(f: ShieldFinding) {
    const text = buildFixPrompt(f);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(f.id);
      setTimeout(() => setCopiedId(null), 1400);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Petal Shield
          </SheetTitle>
          <SheetDescription>
            Automated security audit of your project. Runs locally — no data leaves your browser.
          </SheetDescription>
        </SheetHeader>

        {report && (
          <div className="mt-6 space-y-6">
            {/* Score hero */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Shield Score
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={cn("text-5xl font-semibold tabular-nums", GRADE_COLOR[report.grade])}>
                      {report.grade}
                    </span>
                    <span className="text-2xl font-medium text-muted-foreground tabular-nums">
                      {report.score}
                    </span>
                    <span className="text-sm text-muted-foreground">/100</span>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{report.scannedFiles} files scanned</div>
                  <div className="mt-1">{report.findings.length} finding{report.findings.length === 1 ? "" : "s"}</div>
                </div>
              </div>
              {report.findings.length === 0 && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  No issues detected. Re-run after each backend change.
                </div>
              )}
            </div>

            {/* Findings grouped by severity */}
            {SEVERITY_ORDER.map((sev) => {
              const items = grouped[sev];
              if (!items?.length) return null;
              return (
                <section key={sev} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldAlert className="h-4 w-4" />
                    {SEVERITY_LABEL[sev]}
                    <Badge variant="outline" className={cn("ml-1", SEVERITY_STYLES[sev])}>
                      {items.length}
                    </Badge>
                  </h3>
                  <ul className="space-y-2">
                    {items.map((f) => (
                      <li
                        key={f.id}
                        className="rounded-lg border border-border bg-card p-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium leading-tight">{f.title}</div>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="truncate font-mono">{f.file}</span>
                              {f.line && (
                                <>
                                  <ChevronRight className="h-3 w-3" />
                                  <span>line {f.line}</span>
                                </>
                              )}
                            </div>
                            {f.snippet && (
                              <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                                {f.snippet}
                              </pre>
                            )}
                            <p className="mt-2 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">Fix: </span>
                              {f.fix}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => {
                              if (onSendFixPrompt) {
                                onSendFixPrompt(buildFixPrompt(f));
                                onOpenChange(false);
                              } else {
                                copy(f);
                              }
                            }}
                          >
                            {copiedId === f.id ? (
                              <><Check className="mr-1 h-3 w-3" /> Copied</>
                            ) : onSendFixPrompt ? (
                              "Ask Petal to fix"
                            ) : (
                              <><Copy className="mr-1 h-3 w-3" /> Copy fix</>
                            )}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
