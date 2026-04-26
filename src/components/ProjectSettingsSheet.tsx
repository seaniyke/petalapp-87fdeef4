/**
 * ProjectSettingsSheet — edit a project's custom instructions and manage
 * the attached backend (BYO Supabase v1).
 */
import { useEffect, useState } from "react";
import {
  BookOpen,
  Database,
  Loader2,
  Save,
  Plug,
  CheckCircle2,
  Unplug,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  updateProject,
  getProjectBackend,
  connectProjectBackend,
  disconnectProjectBackend,
  type ProjectRow,
  type ProjectBackend,
} from "@/lib/projects";
import { DomainsSection } from "@/components/DomainsSection";
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
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When set, scroll this section into view after the sheet opens. */
  scrollTo?: "domains" | "backend" | "knowledge" | null;
  onScrollHandled?: () => void;
};

export function ProjectSettingsSheet({
  project,
  onChange,
  trigger,
  open: openProp,
  onOpenChange,
  scrollTo,
  onScrollHandled,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [value, setValue] = useState(project.custom_instructions ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue(project.custom_instructions ?? "");
  }, [open, project.custom_instructions]);

  // Scroll to a requested section once the sheet is open.
  useEffect(() => {
    if (!open || !scrollTo) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`settings-${scrollTo}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      onScrollHandled?.();
    }, 80);
    return () => clearTimeout(t);
  }, [open, scrollTo, onScrollHandled]);

  async function save() {
    setSaving(true);
    try {
      const next = await updateProject(project.id, {
        custom_instructions: value.trim() || null,
      } as never);
      onChange(next);
      toast.success("Project knowledge saved");
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
            title="Project settings"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Settings</span>
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
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Project Settings
          </SheetTitle>
          <SheetDescription>
            Backend connection and project knowledge for this project.
          </SheetDescription>
        </SheetHeader>

        {/* Backend section */}
        <BackendSection projectId={project.id} />

        <div className="mt-8 border-t border-border pt-6">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <BookOpen className="h-4 w-4" /> Project Knowledge
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Anything you write here is sent to Petal on every change so it stays consistent.
            Keep it short — a few rules work best.
          </p>
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, MAX_LEN))}
            placeholder={PLACEHOLDER}
            rows={12}
            className="resize-none font-sans text-sm leading-relaxed"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Tip: write rules, not stories.</span>
            <span>
              {value.length} / {MAX_LEN}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              onClick={save}
              disabled={saving || !dirty}
              size="sm"
              className="inline-flex items-center gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save knowledge
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Backend section ---------------- */

function BackendSection({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<ProjectBackend>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProjectBackend(projectId)
      .then((b) => {
        if (!cancelled) setBackend(b);
      })
      .catch(() => {
        if (!cancelled) setBackend(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleDisconnect() {
    if (!confirm("Disconnect this backend? Your generated app will lose access to it on the next change.")) {
      return;
    }
    try {
      await disconnectProjectBackend(projectId);
      setBackend(null);
      toast.success("Backend disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    }
  }

  return (
    <div className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Database className="h-4 w-4" /> Backend
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </div>
      ) : backend?.status === "ready" ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Connected</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Auth, database, and file storage are connected to{" "}
                <code className="rounded bg-background px-1 py-0.5 text-[11px]">
                  {new URL(backend.supabaseUrl).hostname}
                </code>
                .
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            >
              <Unplug className="h-3 w-3" />
              Disconnect
            </Button>
          </div>
        </div>
      ) : showForm ? (
        <ConnectForm
          projectId={projectId}
          onCancel={() => setShowForm(false)}
          onConnected={(b) => {
            setBackend(b);
            setShowForm(false);
          }}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">
            Add auth, a database, and file storage to your generated app. Connect a Supabase
            project you own — Petal will inject a pre-configured client into the app.
          </p>
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            className="mt-3 inline-flex items-center gap-1.5"
          >
            <Plug className="h-3.5 w-3.5" />
            Connect a backend
          </Button>
        </div>
      )}
    </div>
  );
}

function ConnectForm({
  projectId,
  onCancel,
  onConnected,
}: {
  projectId: string;
  onCancel: () => void;
  onConnected: (b: NonNullable<ProjectBackend>) => void;
}) {
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [serviceRoleKey, setServiceRoleKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await connectProjectBackend({
        projectId,
        supabaseUrl: url.trim(),
        anonKey: anonKey.trim(),
        serviceRoleKey: serviceRoleKey.trim() || undefined,
      });
      toast.success("Backend connected");
      onConnected(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Find these in your Supabase project under Settings → API.
      </p>
      <div className="space-y-1">
        <Label htmlFor="b-url" className="text-xs">
          Project URL
        </Label>
        <Input
          id="b-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://xxx.supabase.co"
          required
          autoComplete="off"
          className="text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="b-anon" className="text-xs">
          Anon (public) key
        </Label>
        <Input
          id="b-anon"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
          placeholder="eyJhbGci…"
          required
          autoComplete="off"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="b-srk" className="text-xs">
          Service role key{" "}
          <span className="text-muted-foreground">(optional, for future migrations)</span>
        </Label>
        <Input
          id="b-srk"
          value={serviceRoleKey}
          onChange={(e) => setServiceRoleKey(e.target.value)}
          placeholder="eyJhbGci…"
          type="password"
          autoComplete="off"
          className="font-mono text-xs"
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting} className="inline-flex items-center gap-1.5">
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          Connect
        </Button>
      </div>
    </form>
  );
}
