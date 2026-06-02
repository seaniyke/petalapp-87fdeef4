/**
 * CloudStorageView — manage storage buckets and files in the project's
 * managed backend. Shows the bucket list at the top level; click a bucket
 * to drill into its files (browse, upload, download, delete).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileIcon,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listProjectBuckets,
  createProjectBucket,
  deleteProjectBucket,
  listProjectObjects,
  deleteProjectObject,
  createProjectObjectUploadUrl,
  createProjectObjectDownloadUrl,
  type CloudBucket,
  type CloudObject,
} from "@/lib/cloud-storage.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CloudEmptyState } from "./CloudEmptyState";

export function CloudStorageView({ projectId }: { projectId: string }) {
  const [bucket, setBucket] = useState<CloudBucket | null>(null);
  return bucket ? (
    <BucketDetail
      projectId={projectId}
      bucket={bucket}
      onBack={() => setBucket(null)}
    />
  ) : (
    <BucketList projectId={projectId} onOpen={setBucket} />
  );
}

/* ---------------- Bucket list ---------------- */

function BucketList({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (b: CloudBucket) => void;
}) {
  const listFn = useServerFn(listProjectBuckets);
  const createFn = useServerFn(createProjectBucket);
  const deleteFn = useServerFn(deleteProjectBucket);

  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [buckets, setBuckets] = useState<CloudBucket[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CloudBucket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listFn({ data: { projectId } });
      setAvailable(r.available);
      setBuckets(r.buckets);
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [listFn, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const b = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteFn({ data: { projectId, bucket: b.name } });
      toast.success(`Deleted bucket "${b.name}"`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (!available && !loading) {
    return (
      <div className="p-4">
        <CloudEmptyState
          title="No backend yet"
          description="Enable Petal Cloud to use file storage for images, documents and uploads."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HardDrive className="h-4 w-4" />
          <span>{buckets.length} buckets</span>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New bucket
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : buckets.length === 0 ? (
        <CloudEmptyState
          title="No buckets yet"
          description="Create a bucket to start storing files."
        />
      ) : (
        <ul className="space-y-2">
          {buckets.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-3 text-sm"
            >
              <button
                type="button"
                onClick={() => onOpen(b)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{b.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    Created {new Date(b.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </button>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  b.isPublic
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {b.isPublic ? "Public" : "Private"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(b)}
                aria-label="Delete bucket"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CreateBucketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (name, isPublic) => {
          await createFn({ data: { projectId, name, isPublic } });
          toast.success(`Bucket "${name}" created`);
          await load();
        }}
      />

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bucket?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.name}" and all files inside it will be permanently
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateBucketDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (name: string, isPublic: boolean) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setIsPublic(false);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onCreate(trimmed, isPublic);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create bucket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New bucket</DialogTitle>
          <DialogDescription>
            Lowercase letters, numbers and hyphens. Public buckets serve files
            over a stable URL; private buckets require a signed URL.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input
              autoFocus
              placeholder="my-uploads"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <div>
              <div className="text-sm font-medium">Public bucket</div>
              <div className="text-xs text-muted-foreground">
                Anyone with the file URL can read it.
              </div>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Bucket detail (files) ---------------- */

function BucketDetail({
  projectId,
  bucket,
  onBack,
}: {
  projectId: string;
  bucket: CloudBucket;
  onBack: () => void;
}) {
  const listFn = useServerFn(listProjectObjects);
  const deleteFn = useServerFn(deleteProjectObject);
  const uploadUrlFn = useServerFn(createProjectObjectUploadUrl);
  const downloadUrlFn = useServerFn(createProjectObjectDownloadUrl);

  const [loading, setLoading] = useState(true);
  const [objects, setObjects] = useState<CloudObject[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CloudObject | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listFn({
        data: { projectId, bucket: bucket.name, prefix: "", limit: 100 },
      });
      setObjects(r.objects.filter((o) => !o.isFolder));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [listFn, projectId, bucket.name]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const { signedUrl } = await uploadUrlFn({
          data: { projectId, bucket: bucket.name, path: safeName },
        });
        const res = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      }
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleDownload = async (o: CloudObject) => {
    try {
      const { url } = await downloadUrlFn({
        data: { projectId, bucket: bucket.name, path: o.name, expiresIn: 300 },
      });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to get link");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const o = confirmDelete;
    setConfirmDelete(null);
    try {
      await deleteFn({ data: { projectId, bucket: bucket.name, path: o.name } });
      toast.success("File deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 text-muted-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Buckets
        </Button>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${
            bucket.isPublic
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {bucket.isPublic ? "Public" : "Private"}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{bucket.name}</div>
          <div className="text-xs text-muted-foreground">
            {objects.length} file{objects.length === 1 ? "" : "s"}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1 h-4 w-4" />
          )}
          Upload
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : objects.length === 0 ? (
        <CloudEmptyState
          title="No files yet"
          description="Upload your first file to this bucket."
        />
      ) : (
        <ul className="space-y-2">
          {objects.map((o) => (
            <li
              key={o.name}
              className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 text-sm"
            >
              <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{o.name}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {formatSize(o.size)}
                  {o.updatedAt &&
                    ` · ${new Date(o.updatedAt).toLocaleDateString()}`}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="File actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => handleDownload(o)}>
                    <Download className="mr-2 h-4 w-4" />
                    Open / download
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setConfirmDelete(o)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.name}" will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
