/**
 * ProjectPhotosSheet — the owner's own photos for one project.
 *
 * Photos added here are used ahead of anything Kimble would invent, so a
 * real shop shows its real room. Uploads go to the public image store under
 * `site/<projectId>/photos/...`, which storage rules already scope to the
 * project owner.
 *
 * The panel says what a photo is for, never how the matching works.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Photo = {
  id: string;
  url: string;
  label: string;
  tags: string[];
  storage_path: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

const BUCKET = "petal-images";
const MAX_BYTES = 10 * 1024 * 1024;

function safeName(name: string): string {
  const ext = (name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext || "jpg"}`;
}

function labelFrom(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 80);
}

export function ProjectPhotosSheet({ open, onOpenChange, projectId }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("project_pictures")
      .select("id,url,label,tags,storage_path")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Couldn't load your photos. Try again.");
      return;
    }
    setPhotos((data ?? []) as Photo[]);
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let added = 0;
    for (const file of Array.from(files).slice(0, 10)) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} isn't an image.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 10MB.`);
        continue;
      }
      const path = `site/${projectId}/photos/${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (upErr) {
        toast.error(`Couldn't add ${file.name}.`);
        continue;
      }
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error: rowErr } = await supabase.from("project_pictures").insert({
        project_id: projectId,
        url,
        storage_path: path,
        label: labelFrom(file.name),
        tags: [],
      });
      if (rowErr) {
        toast.error(`Couldn't save ${file.name}.`);
        continue;
      }
      added += 1;
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (added) toast.success(added === 1 ? "Photo added" : `${added} photos added`);
    void load();
  }

  async function rename(photo: Photo, label: string) {
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, label } : p)));
    await supabase.from("project_pictures").update({ label }).eq("id", photo.id);
  }

  async function remove(photo: Photo) {
    const { error } = await supabase.from("project_pictures").delete().eq("id", photo.id);
    if (error) {
      toast.error("Couldn't remove that photo.");
      return;
    }
    if (photo.storage_path) {
      await supabase.storage.from(BUCKET).remove([photo.storage_path]);
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Your photos</SheetTitle>
        </SheetHeader>

        <p className="mt-2 text-sm text-muted-foreground">
          Add photos of your real business and Kimble will use them in your app
          instead of making pictures up. Name each one so it lands in the right place.
        </p>

        <div className="mt-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ImagePlus className="mr-2 h-4 w-4" />
            )}
            {busy ? "Adding…" : "Add photos"}
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          {loading && photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No photos yet. Anything you add shows up in your next build.
            </p>
          ) : (
            photos.map((photo) => (
              <div key={photo.id} className="flex items-center gap-3 rounded-lg border p-2">
                <img
                  src={photo.url}
                  alt={photo.label || "Uploaded photo"}
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-md object-cover"
                />
                <Input
                  value={photo.label}
                  placeholder="What is this a photo of?"
                  onChange={(e) =>
                    setPhotos((prev) =>
                      prev.map((p) => (p.id === photo.id ? { ...p, label: e.target.value } : p)),
                    )
                  }
                  onBlur={(e) => void rename(photo, e.target.value.trim())}
                  className="h-9"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove photo"
                  onClick={() => void remove(photo)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
