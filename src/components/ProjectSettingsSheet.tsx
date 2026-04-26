/**
 * ProjectSettingsSheet — edit a project's custom instructions
 * ("Project Knowledge"). Mirrors Lovable / Base44's Custom Instructions
 * feature: a small piece of context the owner attaches to the project
 * that Petal silently honors on every change.
 */
import { useEffect, useState } from "react";
import { BookOpen, Loader2, Save } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { updateProject, type ProjectRow } from "@/lib/projects";
import { toast } from "sonner";

const MAX_LEN = 4000;

const PLACEHOLDER = `Examples:

• Always use a soft pastel palette and rounded corners.
• This project is a private prototype for KeshPay — be conservative with changes.
• Never add external auth providers without asking first.
• Prefer plain CSS over heavy libraries.`;

type Props = {
  project: ProjectRow;
  onChange: (next: ProjectRow) => void;
  /** Optional render-prop trigger override. Default is a small toolbar button. */
  trigger?: React.ReactNode;
  /** Optional controlled open state (so it can be opened from a parent menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ProjectSettingsSheet({ project, onChange, trigger, open: openProp, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  // Re-sync when the sheet opens or the underlying project changes.
  useEffect(() => {
    if (open) setValue(project.custom_instructions ?? "");
  }, [open, project.custom_instructions]);

  async function save() {
    setSaving(true);
    try {
      const next = await updateProject(project.id, {
        custom_instructions: value.trim() || null,
      } as never);
      onChange(next);
      toast.success("Project knowledge saved");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const dirty = (value.trim() || "") !== (project.custom_instructions?.trim() ?? "");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <button
            className="hidden h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted md:inline-flex"
            title="Project knowledge — instructions Petal always follows"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Knowledge</span>
            {project.custom_instructions && (
              <span
                aria-hidden
                className="ml-1 h-1.5 w-1.5 rounded-full bg-primary"
                title="Custom instructions are active"
              />
            )}
          </button>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Project Knowledge
          </SheetTitle>
          <SheetDescription>
            Anything you write here is sent to Petal on every change so it stays consistent. Keep
            it short — a few rules work best.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, MAX_LEN))}
            placeholder={PLACEHOLDER}
            rows={14}
            className="resize-none font-sans text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Tip: write rules, not stories. Petal reads this every turn.</span>
            <span>
              {value.length} / {MAX_LEN}
            </span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="text-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 text-sm"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save knowledge
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
