import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilePlus2, FileMinus2, FileEdit, Loader2, Undo2 } from "lucide-react";
import type { ProjectFile } from "@/server/generate.server";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  currentFiles: ProjectFile[];
  targetFiles: ProjectFile[];
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
};

type ChangeRow =
  | { kind: "added"; path: string; addedLines: number }
  | { kind: "removed"; path: string; removedLines: number }
  | { kind: "modified"; path: string; addedLines: number; removedLines: number };

/** Lightweight line-level diff stats — no external dep. */
function diffLineStats(before: string, after: string): { added: number; removed: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  // Build a set-based heuristic: lines in B not in A = added; in A not in B = removed.
  // This isn't a true LCS diff but is fast and good enough for a preview.
  const aCount = new Map<string, number>();
  for (const l of a) aCount.set(l, (aCount.get(l) ?? 0) + 1);
  const bCount = new Map<string, number>();
  for (const l of b) bCount.set(l, (bCount.get(l) ?? 0) + 1);
  let added = 0;
  let removed = 0;
  for (const [line, n] of bCount) {
    const prev = aCount.get(line) ?? 0;
    if (n > prev) added += n - prev;
  }
  for (const [line, n] of aCount) {
    const next = bCount.get(line) ?? 0;
    if (n > next) removed += n - next;
  }
  return { added, removed };
}

function computeChanges(current: ProjectFile[], target: ProjectFile[]): ChangeRow[] {
  const curMap = new Map(current.map((f) => [f.path, f.content]));
  const tgtMap = new Map(target.map((f) => [f.path, f.content]));
  const rows: ChangeRow[] = [];
  // Added or modified
  for (const [path, tgtContent] of tgtMap) {
    const curContent = curMap.get(path);
    if (curContent === undefined) {
      rows.push({ kind: "added", path, addedLines: tgtContent.split("\n").length });
    } else if (curContent !== tgtContent) {
      const { added, removed } = diffLineStats(curContent, tgtContent);
      if (added !== 0 || removed !== 0) {
        rows.push({ kind: "modified", path, addedLines: added, removedLines: removed });
      }
    }
  }
  // Removed
  for (const [path, curContent] of curMap) {
    if (!tgtMap.has(path)) {
      rows.push({ kind: "removed", path, removedLines: curContent.split("\n").length });
    }
  }
  // Sort: modified first, then added, then removed; alpha within each.
  const order = { modified: 0, added: 1, removed: 2 } as const;
  rows.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path));
  return rows;
}

export function RevertPreviewDialog({
  open,
  onOpenChange,
  title = "Preview revert",
  description = "Review what will change before reverting. Your current state is saved as a snapshot first, so this is non-destructive — you can always come back.",
  currentFiles,
  targetFiles,
  busy = false,
  onConfirm,
  confirmLabel = "Revert to here",
}: Props) {
  const changes = useMemo(
    () => computeChanges(currentFiles, targetFiles),
    [currentFiles, targetFiles],
  );

  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (const c of changes) {
      if (c.kind === "added") added += 1;
      else if (c.kind === "removed") removed += 1;
      else modified += 1;
    }
    return { added, removed, modified };
  }, [changes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            <FileEdit className="h-3 w-3" /> {counts.modified} modified
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
            <FilePlus2 className="h-3 w-3" /> {counts.added} added
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-rose-700 dark:text-rose-400">
            <FileMinus2 className="h-3 w-3" /> {counts.removed} removed
          </span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border bg-card/60">
          {changes.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No file differences — your current state already matches this version.
            </div>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {changes.map((c) => (
                <li key={`${c.kind}:${c.path}`} className="flex items-center gap-2 px-3 py-2">
                  {c.kind === "added" && (
                    <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {c.kind === "removed" && (
                    <FileMinus2 className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                  )}
                  {c.kind === "modified" && (
                    <FileEdit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{c.path}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
                    {c.kind !== "removed" && (c as { addedLines?: number }).addedLines ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        +{(c as { addedLines: number }).addedLines}
                      </span>
                    ) : null}
                    {c.kind !== "added" && (c as { removedLines?: number }).removedLines ? (
                      <span className="text-rose-600 dark:text-rose-400">
                        −{(c as { removedLines: number }).removedLines}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm transition hover:bg-muted disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy || changes.length === 0}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-sm text-background transition hover:brightness-105 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Undo2 className="h-3.5 w-3.5" />
            )}
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
