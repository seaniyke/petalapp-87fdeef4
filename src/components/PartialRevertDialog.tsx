/**
 * PartialRevertDialog — Petal "Time Machine" per-file revert.
 *
 * Differentiator vs Lovable / Bolt / v0:
 *  - Their history is all-or-nothing (revert the entire snapshot).
 *  - This dialog diffs a chosen snapshot against the current files and lets
 *    the user pick exactly which files to roll back. Solves the #1 user
 *    complaint: "fixing one thing breaks two others — and now I have to
 *    nuke my whole project to get the working bits back."
 */
import { useMemo, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import type { ProjectFile } from "@/server/generate.server";
import type { VersionRow } from "@/lib/versions";

type DiffStatus = "added" | "removed" | "modified";

type DiffEntry = {
  path: string;
  status: DiffStatus;
  // bytes changed (rough heuristic)
  delta: number;
};

type Props = {
  version: VersionRow | null;
  currentFiles: ProjectFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (mergedFiles: ProjectFile[]) => Promise<void> | void;
};

function diffFiles(snapshot: ProjectFile[], current: ProjectFile[]): DiffEntry[] {
  const snapMap = new Map(snapshot.map((f) => [f.path, f.content]));
  const curMap = new Map(current.map((f) => [f.path, f.content]));
  const paths = new Set<string>([...snapMap.keys(), ...curMap.keys()]);
  const out: DiffEntry[] = [];
  for (const path of paths) {
    const s = snapMap.get(path);
    const c = curMap.get(path);
    if (s === undefined && c !== undefined) {
      // file exists now but not in snapshot — reverting would REMOVE it
      out.push({ path, status: "removed", delta: c.length });
    } else if (s !== undefined && c === undefined) {
      // file was in snapshot but is gone — reverting would re-ADD it
      out.push({ path, status: "added", delta: s.length });
    } else if (s !== undefined && c !== undefined && s !== c) {
      out.push({ path, status: "modified", delta: Math.abs(s.length - c.length) });
    }
  }
  // Sort: modified first, then added, then removed; alphabetical within
  return out.sort((a, b) => {
    const order = { modified: 0, added: 1, removed: 2 } as const;
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.path.localeCompare(b.path);
  });
}

function statusLabel(s: DiffStatus) {
  switch (s) {
    case "added":
      return { text: "will restore", cls: "text-emerald-500" };
    case "removed":
      return { text: "will delete", cls: "text-rose-500" };
    case "modified":
      return { text: "will overwrite", cls: "text-amber-500" };
  }
}

export function PartialRevertDialog({
  version,
  currentFiles,
  open,
  onOpenChange,
  onApply,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const diff = useMemo(
    () => (version ? diffFiles(version.files, currentFiles) : []),
    [version, currentFiles],
  );

  // Reset selection whenever the dialog opens with a fresh version
  useMemo(() => {
    if (open && version) {
      setSelected(new Set(diff.map((d) => d.path)));
    }
  }, [open, version, diff]);

  const allSelected = selected.size === diff.length && diff.length > 0;
  const noneSelected = selected.size === 0;

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(diff.map((d) => d.path)));
  }

  async function handleApply() {
    if (!version) return;
    setBusy(true);
    try {
      const snapMap = new Map(version.files.map((f) => [f.path, f.content]));
      const curMap = new Map(currentFiles.map((f) => [f.path, f.content]));

      // Apply per-path: chosen paths come from the snapshot, others from current.
      // For "added" rows (file existed in snapshot but not now) — restore from snapshot.
      // For "removed" rows (exists now, not in snapshot) — delete (omit from output).
      // For "modified" rows — take snapshot content.
      const out: ProjectFile[] = [];
      const allPaths = new Set<string>([...curMap.keys(), ...snapMap.keys()]);
      for (const path of allPaths) {
        const isSelected = selected.has(path);
        const inSnap = snapMap.has(path);
        const inCur = curMap.has(path);

        if (isSelected) {
          if (inSnap) {
            out.push({ path, content: snapMap.get(path)! });
          }
          // else: selected & not in snapshot → that means "removed" status → omit
        } else {
          // unchanged path or user opted out: keep current
          if (inCur) {
            out.push({ path, content: curMap.get(path)! });
          }
        }
      }

      await onApply(out);
      toast.success(`Reverted ${selected.size} file${selected.size === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't revert");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-base">Revert specific files</DialogTitle>
          <DialogDescription className="text-xs">
            Pick exactly what to roll back from this checkpoint. Everything else stays as-is.
          </DialogDescription>
        </DialogHeader>

        {diff.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            This checkpoint is identical to your current files.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={toggleAll}
                className="font-medium text-foreground hover:underline"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              <span className="tabular-nums">
                {selected.size} of {diff.length} selected
              </span>
            </div>
            <ScrollArea className="max-h-[55vh]">
              <ul className="divide-y divide-border/60">
                {diff.map((d) => {
                  const meta = statusLabel(d.status);
                  const isSel = selected.has(d.path);
                  return (
                    <li
                      key={d.path}
                      className="flex items-start gap-3 px-5 py-3 hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggle(d.path)}
                        className="mt-0.5"
                        aria-label={`Toggle ${d.path}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs">{d.path}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className={meta.cls}>{meta.text}</span>
                          <span>·</span>
                          <span className="tabular-nums">{d.delta} B Δ</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </>
        )}

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={busy || noneSelected || diff.length === 0}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Revert {selected.size || ""} file{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
