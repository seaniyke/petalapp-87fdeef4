import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw, Trash2, Pencil, Pin, Check, X, FileStack } from "lucide-react";
import { PartialRevertDialog } from "@/components/PartialRevertDialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  createVersion,
  deleteVersion,
  listVersions,
  renameVersion,
  type VersionRow,
} from "@/lib/versions";
import type { ProjectFile } from "@/server/generate.server";
import { toast } from "sonner";
import { RevertPreviewDialog } from "@/components/RevertPreviewDialog";

type Props = {
  projectId: string;
  currentFiles: ProjectFile[];
  onRestore: (files: ProjectFile[]) => Promise<void> | void;
  refreshKey: number;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function HistoryPanel({ projectId, currentFiles, onRestore, refreshKey }: Props) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [previewVersion, setPreviewVersion] = useState<VersionRow | null>(null);
  const [partialVersion, setPartialVersion] = useState<VersionRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setVersions(await listVersions(projectId));
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshKey]);

  async function handleSaveCurrent() {
    setLoading(true);
    try {
      await createVersion(projectId, currentFiles, {
        origin: "manual",
        label: `Saved ${new Date().toLocaleString()}`,
      });
      toast.success("Version saved");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save version");
    } finally {
      setLoading(false);
    }
  }

  function requestRestore(v: VersionRow) {
    setPreviewVersion(v);
  }

  async function confirmRestore() {
    const v = previewVersion;
    if (!v) return;
    setBusyId(v.id);
    try {
      // Snapshot current state before overwriting
      if (currentFiles.length) {
        await createVersion(projectId, currentFiles, {
          origin: "auto",
          label: "Before restore",
        });
      }
      await onRestore(v.files);
      toast.success("Restored");
      setPreviewVersion(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't restore");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(v: VersionRow) {
    if (!confirm("Delete this version permanently?")) return;
    setBusyId(v.id);
    try {
      await deleteVersion(v.id);
      await refresh();
    } catch (e) {
      toast.error("Couldn't delete");
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function commitRename(v: VersionRow) {
    setBusyId(v.id);
    try {
      await renameVersion(v.id, editValue);
      setEditingId(null);
      await refresh();
    } catch (e) {
      toast.error("Couldn't rename");
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted"
          title="Version history"
        >
          <History className="h-3.5 w-3.5" /> History
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle className="font-display text-xl">Version history</SheetTitle>
          <SheetDescription>
            Snapshots are saved automatically after each AI generation. The 50 most recent
            auto-snapshots are kept.
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border p-3">
          <button
            onClick={handleSaveCurrent}
            disabled={loading || currentFiles.length === 0}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-sm text-background transition hover:brightness-105 disabled:opacity-40"
          >
            <Pin className="h-3.5 w-3.5" /> Save current as version
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && versions.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : versions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
              No versions yet. They'll appear here after your next AI build.
            </div>
          ) : (
            <ul className="space-y-2">
              {versions.map((v, i) => (
                <li
                  key={v.id}
                  className="rounded-2xl border border-border bg-card p-3 text-sm shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {editingId === v.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => void commitRename(v)}
                            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium uppercase tracking-wider ${
                              v.origin === "manual"
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {v.origin === "manual" ? "saved" : i === 0 ? "latest" : "auto"}
                          </span>
                          <span className="truncate font-medium">
                            {v.label ?? `Snapshot · ${timeAgo(v.created_at)}`}
                          </span>
                        </div>
                      )}
                      {v.summary && editingId !== v.id && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {v.summary}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {timeAgo(v.created_at)} · {v.files.length} file
                        {v.files.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {editingId !== v.id && (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            setEditingId(v.id);
                            setEditValue(v.label ?? "");
                          }}
                          disabled={busyId === v.id}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted"
                          title="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => requestRestore(v)}
                          disabled={busyId === v.id}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted"
                          title="Restore this version"
                        >
                          {busyId === v.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => void handleDelete(v)}
                          disabled={busyId === v.id}
                          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
      <RevertPreviewDialog
        open={previewVersion !== null}
        onOpenChange={(o) => {
          if (!o) setPreviewVersion(null);
        }}
        title={`Restore "${previewVersion?.label ?? (previewVersion ? timeAgo(previewVersion.created_at) : "")}"`}
        description="Review which files will change. Your current state is saved as an automatic snapshot first, so nothing is lost — you can always restore back."
        currentFiles={currentFiles}
        targetFiles={previewVersion?.files ?? []}
        busy={busyId === previewVersion?.id}
        onConfirm={confirmRestore}
        confirmLabel="Restore this version"
      />
    </Sheet>
  );
}
