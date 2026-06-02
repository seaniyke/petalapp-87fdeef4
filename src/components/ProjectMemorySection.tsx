/**
 * ProjectMemorySection — surfaces "What Petal remembers" in the
 * Project Settings sheet. Lists every row in `project_memory` for this
 * project and lets the user delete individual entries or clear all of
 * them. Reads/writes go through authenticated server functions — RLS
 * enforces ownership.
 */
import { useEffect, useState } from "react";
import { Brain, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  listProjectMemory,
  forgetProjectMemoryEntry,
  forgetAllProjectMemory,
  type ProjectMemoryRow,
} from "@/lib/project-memory.functions";

export function ProjectMemorySection({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<ProjectMemoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await listProjectMemory({ data: { projectId } });
      setEntries(res.entries);
    } catch (e) {
      console.warn("[project-memory] list failed in UI:", e);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleForget = async (id: string) => {
    setBusyId(id);
    try {
      const res = await forgetProjectMemoryEntry({
        data: { projectId, entryId: id },
      });
      if (!res.ok) throw new Error(res.error ?? "Could not forget this entry.");
      setEntries((cur) => (cur ?? []).filter((e) => e.id !== id));
      toast.success("Petal forgot that.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not forget this.");
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Forget everything Petal remembers about this project?")) return;
    setClearing(true);
    try {
      const res = await forgetAllProjectMemory({ data: { projectId } });
      if (!res.ok) throw new Error(res.error ?? "Could not clear memory.");
      setEntries([]);
      toast.success("Petal's memory cleared.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clear memory.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mt-8 scroll-mt-4 border-t border-border pt-6">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Brain className="h-4 w-4" /> What Petal remembers
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Stable facts Petal carries between turns so it doesn't start from
        zero. Forget anything that's outdated.
      </p>

      {loading && entries === null ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : entries && entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          Nothing remembered yet. Petal will start saving stable choices
          (audience, tone, palette, must-haves) as you build.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {entries?.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-foreground">{e.key}</div>
                <div className="text-muted-foreground break-words">{e.value}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId === e.id}
                onClick={() => handleForget(e.id)}
                className="h-7 shrink-0 px-2 text-muted-foreground hover:text-foreground"
                aria-label={`Forget ${e.key}`}
              >
                {busyId === e.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={clearing}
            onClick={handleClearAll}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {clearing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Forget everything
          </Button>
        </div>
      )}
    </div>
  );
}
