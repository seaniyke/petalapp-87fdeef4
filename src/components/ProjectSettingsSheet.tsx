/**
 * ProjectSettingsSheet — edit a project's custom instructions and manage
 * the attached backend (BYO Supabase v1).
 */
import { useEffect, useState } from "react";
import {
  BookOpen,
  Cloud,
  Database,
  Loader2,
  Save,
  CheckCircle2,
  Unplug,
  Sparkles,
  Lock,
  Globe,
  ChevronRight,
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
import { Button } from "@/components/ui/button";
import {
  updateProject,
  getProjectBackend,
  disconnectProjectBackend,
  type ProjectRow,
  type ProjectBackend,
} from "@/lib/projects";
import { DomainsSection } from "@/components/DomainsSection";
import { EmailSection } from "@/components/EmailSection";
import { MobileAppPanel } from "@/components/MobileAppPanel";
import { ManagedBackendCard } from "@/components/ManagedBackendCard";
import { LabsSection } from "@/components/LabsSection";
import { ProjectMemorySection } from "@/components/ProjectMemorySection";
import { CloudPanelSheet } from "@/components/cloud/CloudPanelSheet";
import { CloudBalanceSheet } from "@/components/CloudBalanceSheet";
import { useWallet } from "@/hooks/use-wallet";
import { Switch } from "@/components/ui/switch";
import { builderDraftKeys, clearDraft, readDraft, writeDraft } from "@/lib/draft-storage";
import { toast } from "sonner";

const MAX_LEN = 4000;

const PLACEHOLDER = `Examples:

• Stick to a minimal black-and-white palette with one accent color.
• This is an internal tool — keep flows short and skip onboarding.
• Use shadcn components; don't pull in new UI libraries.
• Always show empty states with a clear next action.`;

type Props = {
  project: ProjectRow;
  onChange: (next: ProjectRow) => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When set, scroll this section into view after the sheet opens. */
 scrollTo?:
   | "domains"
   | "backend"
   | "knowledge"
   | "email"
   | "payments"
   | "seo"
   | "analytics"
   | "ai"
   | "storage"
   | "realtime"
    | "cron"
    | "mobile"
    | null;
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
  const [cloudOpen, setCloudOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [domainsOpen, setDomainsOpen] = useState(false);

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

  // Scroll to a requested section once the sheet is open. Domains is a
  // dedicated sub-sheet now (Lovable-style top-level entry), so route there
  // directly instead of scrolling.
  useEffect(() => {
    if (!open || !scrollTo) return;
    if (scrollTo === "domains") {
      setDomainsOpen(true);
      onScrollHandled?.();
      return;
    }
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
    <>
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

        {/* Cloud entry — opens the per-project Cloud panel (AI usage,
            database, users, storage, secrets, logs and danger zone). */}
        <button
          type="button"
          onClick={() => setCloudOpen(true)}
          className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-left transition hover:border-primary/40 hover:bg-muted/60"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-background text-primary">
            <Cloud className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Petal Cloud</div>
            <div className="text-xs text-muted-foreground">
              AI usage, database, users, storage, secrets and more.
            </div>
          </div>
          <span className="text-xs text-muted-foreground">Open</span>
        </button>

        {/* Domains — top-level entry (Lovable-style). Opens a dedicated
            sub-sheet so users can find and manage domains in one tap. */}
        <button
          type="button"
          onClick={() => setDomainsOpen(true)}
          id="settings-domains"
          className="mt-3 flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-left transition hover:border-primary/40 hover:bg-muted/60"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-background text-primary">
            <Globe className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Domains</div>
            <div className="text-xs text-muted-foreground">
              Buy a new domain or connect one you already own.
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Backend section */}
        <div id="settings-backend" className="scroll-mt-4">
          <BackendSection projectId={project.id} />
        </div>

        {/* Petal Email section */}
        <div id="settings-email" className="scroll-mt-4">
          <EmailSection projectId={project.id} />
        </div>

        {/* Mobile app section (Tier 2 native shell) */}
        <MobileAppPanel projectId={project.id} />

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

        {/* Integrations marketplace removed — Petal scaffolds third-party
            SDKs directly from prompts and asks for any required secrets via
            the inline SecretRequestCard. The backend tables and API remain
            intact so existing installs keep working. */}

        {/* Labs toggles */}
        <LabsSection />
      </SheetContent>
    </Sheet>

    {/* Per-project Cloud hub + Cloud & AI balance, mounted as siblings of
        the settings sheet so their portals/focus-traps don't fight. */}
    <CloudPanelSheet
      open={cloudOpen}
      onOpenChange={setCloudOpen}
      projectId={project.id}
      onOpenBalance={() => {
        setCloudOpen(false);
        setBalanceOpen(true);
      }}
    />
    <CloudBalanceSheet open={balanceOpen} onOpenChange={setBalanceOpen} />

    {/* Dedicated Domains sheet — top-level entry, mirrors how Lovable
        surfaces Domains as its own settings page. */}
    <Sheet open={domainsOpen} onOpenChange={setDomainsOpen}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> Domains
          </SheetTitle>
          <SheetDescription>
            Manage your project's URLs and custom domains.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <DomainsSection
            projectId={project.id}
            hasPublishedBuild={!!project.latest_build_id}
          />
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}

/* ---------------- Backend section ---------------- */

function BackendSection({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<ProjectBackend>(null);
  

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
              <div className="font-medium">Backend connected</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Auth, database and file storage are connected to an external backend
                you control.
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
        // Nothing connected — show Petal Cloud option only
        <ManagedBackendCard
          projectId={projectId}
          backend={backend}
          onChanged={refresh}
        />
      )}
    </div>
  );
}


/* ---------------- Powered by Petal badge ---------------- */

function PetalBadgeSection({
  project,
  onChange,
}: {
  project: ProjectRow;
  onChange: (next: ProjectRow) => void;
}) {
  const { plan, loading: walletLoading } = useWallet();
  const isPaidPlan = !!plan && plan.code !== "free";
  const [saving, setSaving] = useState(false);
  const hidden = !!project.hide_petal_badge;
  // Effective: free-tier always shows badge regardless of flag.
  const effectivelyShown = !(isPaidPlan && hidden);

  async function toggle(nextHidden: boolean) {
    if (!isPaidPlan) return;
    setSaving(true);
    try {
      const next = await updateProject(project.id, {
        hide_petal_badge: nextHidden,
      });
      onChange(next);
      toast.success(nextHidden ? "Badge will be hidden on next build" : "Badge will show on next build");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4" /> Powered by Petal badge
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        A small floating badge appears in the bottom-right of your built app.
        {isPaidPlan
          ? " You can hide it anytime."
          : " Upgrade to a paid plan to hide it on your deployed app."}
      </p>

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          {!isPaidPlan && (
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="text-sm">
            <div className="font-medium">
              {effectivelyShown ? "Showing on your app" : "Hidden on your app"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isPaidPlan
                ? "Toggle to hide or show. Takes effect on the next build."
                : "Free plan always shows the badge."}
            </div>
          </div>
        </div>
        <Switch
          checked={!hidden}
          disabled={!isPaidPlan || saving || walletLoading}
          onCheckedChange={(checked) => toggle(!checked)}
          aria-label="Show Powered by Petal badge"
        />
      </div>
    </div>
  );
}
