/**
 * RenameProjectDialog — small controlled dialog for renaming a project.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { updateProject, type ProjectRow } from "@/lib/projects";
import { toast } from "sonner";

type Props = {
  project: ProjectRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (next: ProjectRow) => void;
};

export function RenameProjectDialog({ project, open, onOpenChange, onChange }: Props) {
  const [title, setTitle] = useState(project.title ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setTitle(project.title ?? "");
  }, [open, project.title]);

  async function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Project name can't be empty");
      return;
    }
    if (trimmed === project.title) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      const next = await updateProject(project.id, { title: trimmed } as never);
      onChange(next);
      toast.success("Project renamed");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>Choose a new name for this project.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="project-title">Project name</Label>
          <Input
            id="project-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            autoFocus
            maxLength={120}
            placeholder="My awesome app"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
