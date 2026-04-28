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
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Lock,
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
import { ManagedBackendCard } from "@/components/ManagedBackendCard";
import { LabsSection } from "@/components/LabsSection";
import { IntegrationsSection } from "@/components/IntegrationsSection";
import { useLabsFlag } from "@/hooks/use-labs-flags";
import { useWallet } from "@/hooks/use-wallet";
import { Switch } from "@/components/ui/switch";
import { builderDraftKeys, clearDraft, readDraft, writeDraft } from "@/lib/draft-storage";
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
  // Initial value: prefer an unsaved draft (rescued from a previous tab/refresh)
  // over the saved value, so an in-progress edit isn't silently discarded.
  const knowledgeKey = builderDraftKeys.knowledge(project.id);
  const [value, setValue] = useState(() => {
    const draft = readDraft<string>(knowledgeKey);
    return draft ?? (project.custom_instructions ?? "");
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Re-check for a draft when the sheet (re)opens — it may have been written
    // by another open-instance or by a different tab in the same session.
    const draft = readDraft<string>(knowledgeKey);
    setValue(draft ?? (project.custom_instructions ?? ""));
  }, [open, project.custom_instructions, knowledgeKey]);

  // Mirror unsaved edits to sessionStorage so a refresh keeps them. We only
  // write when the value diverges from the saved version — once the user
  // matches what's already on the server, there's nothing to "rescue".
  useEffect(() => {
    const saved = project.custom_instructions ?? "";
    if (value === saved) {
      clearDraft(knowledgeKey);
    } else {
      writeDraft(knowledgeKey, value);
    }
  }, [value, project.custom_instructions, knowledgeKey]);

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
      // The saved version now matches what's in the textarea — drop the draft
      // so a refresh doesn't make it look like there are unsaved changes.
      clearDraft(knowledgeKey);
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
            Domains, backend connection and project knowledge for this project.
          </SheetDescription>
        </SheetHeader>

        {/* Domains section */}
        <div id="settings-domains" className="scroll-mt-4">
          <DomainsSection
            projectId={project.id}
            hasPublishedBuild={!!project.latest_build_id}
          />
        </div>

        {/* Backend section */}
        <div id="settings-backend" className="scroll-mt-4">
          <BackendSection projectId={project.id} />
        </div>

        <div id="settings-knowledge" className="mt-8 scroll-mt-4 border-t border-border pt-6">
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

        {/* Powered by Petal badge toggle */}
        <PetalBadgeSection project={project} onChange={onChange} />

        {/* Integrations marketplace — gated by Labs flag */}
        <IntegrationsSectionGated projectId={project.id} />

        {/* Labs toggles */}
        <LabsSection />
      </SheetContent>
    </Sheet>
  );
}

function IntegrationsSectionGated({ projectId }: { projectId: string }) {
  const enabled = useLabsFlag("integrations_marketplace");
  if (!enabled) return null;
  return <IntegrationsSection projectId={projectId} />;
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

  const isManaged = backend?.provider === "managed_petal";
  const isByo = backend?.provider === "byo_supabase" && backend.status === "ready";

  async function refresh() {
    try {
      const b = await getProjectBackend(projectId);
      setBackend(b);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Database className="h-4 w-4" /> Backend
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </div>
      ) : isByo ? (
        // BYO connected — show only this card
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Connected (your Supabase)</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Auth, database, and file storage are connected to{" "}
                <code className="rounded bg-background px-1 py-0.5 text-[11px]">
                  {new URL(backend!.supabaseUrl).hostname}
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
      ) : isManaged ? (
        // Managed flow — single card handles all states
        <ManagedBackendCard
          projectId={projectId}
          backend={backend}
          onChanged={refresh}
        />
      ) : (
        // Nothing connected — show both options
        <div className="space-y-3">
          <ManagedBackendCard
            projectId={projectId}
            backend={backend}
            onChanged={refresh}
          />
          {showForm ? (
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
                Already have a Supabase project? Connect it for free — Petal will inject a
                pre-configured client into the generated app.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowForm(true)}
                className="mt-3 inline-flex items-center gap-1.5"
              >
                <Plug className="h-3.5 w-3.5" />
                Connect existing (free)
              </Button>
            </div>
          )}
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Build a best-effort deep link to the user's Supabase API settings page
  // once they've pasted a valid project URL. Falls back to the dashboard.
  const apiSettingsUrl = (() => {
    const m = url.trim().match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
    return m
      ? `https://supabase.com/dashboard/project/${m[1]}/settings/api`
      : "https://supabase.com/dashboard/projects";
  })();

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
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-3">
      {/* Step 1 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            1
          </span>
          <p className="text-xs font-medium">Open your Supabase API settings</p>
        </div>
        <a
          href={apiSettingsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground transition hover:bg-muted"
        >
          <ExternalLink className="h-3 w-3" />
          {url.trim() ? "Open this project's API settings" : "Open Supabase dashboard"}
        </a>
      </div>

      {/* Step 2 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            2
          </span>
          <p className="text-xs font-medium">Paste the Project URL</p>
        </div>
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

      {/* Step 3 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            3
          </span>
          <p className="text-xs font-medium">Paste the Public API key</p>
        </div>
        <Input
          id="b-anon"
          value={anonKey}
          onChange={(e) => setAnonKey(e.target.value)}
          placeholder="eyJhbGci…"
          required
          autoComplete="off"
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Labelled <span className="font-medium">anon</span> /{" "}
          <span className="font-medium">public</span> in Supabase. Safe to share.
        </p>
      </div>

      {/* Advanced */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          {showAdvanced ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-1">
            <Label htmlFor="b-srk" className="text-xs">
              Secret key{" "}
              <span className="text-muted-foreground">(optional)</span>
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
            <p className="text-[11px] text-muted-foreground">
              Used later for managed migrations. Leave blank if unsure.
            </p>
          </div>
        )}
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
