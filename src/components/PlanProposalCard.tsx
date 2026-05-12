import { useMemo } from "react";
import { Check, X, FilePlus2, FilePen, FileMinus2, ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export type PlanFile = {
  path: string;
  intent: "edit" | "create" | "delete";
  reason: string;
};

export type ProposedPlan = {
  planId: string;
  summary: string;
  risk: "low" | "medium" | "high";
  files: PlanFile[];
  allowedPaths: Set<string>;
  sourcePrompt: string;
};

const intentConfig: Record<
  PlanFile["intent"],
  { label: string; Icon: typeof FilePen; className: string }
> = {
  edit: {
    label: "Edit",
    Icon: FilePen,
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/20",
  },
  create: {
    label: "New",
    Icon: FilePlus2,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  },
  delete: {
    label: "Delete",
    Icon: FileMinus2,
    className: "bg-destructive/10 text-destructive ring-destructive/20",
  },
};

const riskConfig: Record<
  ProposedPlan["risk"],
  { label: string; Icon: typeof Shield; className: string }
> = {
  low: {
    label: "Low risk",
    Icon: ShieldCheck,
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  },
  medium: {
    label: "Medium risk",
    Icon: Shield,
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  },
  high: {
    label: "High risk",
    Icon: ShieldAlert,
    className: "bg-destructive/10 text-destructive ring-destructive/20",
  },
};

function splitPath(path: string) {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", name: path };
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

export function PlanProposalCard({
  plan,
  onToggle,
  onSelectAll,
  onSelectNone,
  onCancel,
  onApprove,
}: {
  plan: ProposedPlan;
  onToggle: (path: string, checked: boolean) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onCancel: () => void;
  onApprove: () => void;
}) {
  const total = plan.files.length;
  const selected = plan.allowedPaths.size;
  const allSelected = selected === total;
  const risk = riskConfig[plan.risk];
  const RiskIcon = risk.Icon;

  const sortedFiles = useMemo(
    () =>
      [...plan.files].sort((a, b) => {
        const order = { create: 0, edit: 1, delete: 2 } as const;
        return order[a.intent] - order[b.intent] || a.path.localeCompare(b.path);
      }),
    [plan.files],
  );

  return (
    <div className="border-t border-border bg-gradient-to-b from-muted/40 to-background animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="p-3">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Plan
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                  risk.className,
                )}
              >
                <RiskIcon className="h-2.5 w-2.5" />
                {risk.label}
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {selected}/{total} file{total === 1 ? "" : "s"}
              </span>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Cancel plan"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Summary */}
          <div className="px-3 pt-2 pb-1">
            <p className="text-xs leading-relaxed text-foreground">{plan.summary}</p>
          </div>

          {/* Select all/none */}
          <div className="flex items-center gap-3 px-3 pb-2">
            <button
              type="button"
              onClick={allSelected ? onSelectNone : onSelectAll}
              className="text-[10px] font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>

          {/* File list */}
          <ul className="max-h-56 overflow-y-auto border-t border-border/60">
            {sortedFiles.map((f) => {
              const checked = plan.allowedPaths.has(f.path);
              const cfg = intentConfig[f.intent];
              const Icon = cfg.Icon;
              const { dir, name } = splitPath(f.path);
              return (
                <li key={f.path}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 px-3 py-2 text-[11px] transition hover:bg-muted/50",
                      !checked && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                    >
                      {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => onToggle(f.path, e.target.checked)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ring-1 ring-inset",
                        cfg.className,
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      {cfg.label}
                    </span>
                    <span className="min-w-0 flex-1">
                      <code className="block truncate font-mono text-[11px] text-foreground">
                        <span className="text-muted-foreground">{dir}</span>
                        <span className="font-semibold">{name}</span>
                      </code>
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                        {f.reason}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selected === 0}
              onClick={onApprove}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-[11px] font-semibold text-background shadow-sm transition",
                "hover:scale-[1.02] active:scale-[0.98]",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100",
              )}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
              Approve & build
              <span className="opacity-70">
                · {selected} file{selected === 1 ? "" : "s"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
