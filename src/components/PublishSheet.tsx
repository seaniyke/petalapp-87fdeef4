/**
 * PublishSheet — bottom sheet (mobile) / centered dialog (desktop) that
 * shows the project's published state, modeled on Lovable's Publish sheet.
 *
 * Phase 2 model: we now distinguish the *latest preview build* (always rebuilt
 * on every prompt — what the in-builder preview shows) from the *published
 * build* (`projects.published_build_id`, what visitors on the custom domain
 * see). Hitting Publish/Update calls `/api/publish` which pins the current
 * latest build as the published one. Visibility lives in
 * `projects.published_visibility` (`public` | `private` | `unpublished`).
 *
 * Header status maps to:
 *   - "Live"             — published build === latest build, ready
 *   - "Update available" — latest preview newer than published build
 *   - "Publishing…"      — a build is pending
 *   - "Failed"           — latest build failed
 *   - "Private"          — published_visibility = 'private'
 *   - "Unpublished"      — published_visibility = 'unpublished'
 *
 * CTA states:
 *   - "Publish"        — never published (no pinned build yet)
 *   - "Update"         — pinned but newer build is ready
 *   - "Up to date"     — pinned and current
 *   - "Publishing…"    — build pending
 *   - "Retry publish"  — last build failed
 */
import { useEffect, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Globe,
  Lock,
  Copy,
  Check,
  Link2,
  Loader2,
  Settings as SettingsIcon,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  EyeOff,
} from "lucide-react";
import { triggerBuild } from "@/lib/builds";
import { publishProject, type PublishVisibility } from "@/lib/publish";
import { resolvePublishedUrl, type PublishedUrlResult } from "@/lib/published-url";
import { type ProjectRow } from "@/lib/projects";
import { useBuildActivity } from "@/hooks/use-build-activity";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRow;
  onChange: (next: ProjectRow) => void;
  /** Open the project settings sheet scrolled to the Domains section. */
  onManageDomains: () => void;
  /** Open the project settings sheet on the default landing. */
  onOpenSettings: () => void;
};

export function PublishSheet({
  open,
  onOpenChange,
  project,
  onChange,
  onManageDomains,
  onOpenSettings,
}: Props) {
  const buildSnap = useBuildActivity(project.latest_build_id ?? null);
  const [resolved, setResolved] = useState<PublishedUrlResult>({
    url: null,
    source: "none",
    display: null,
  });
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);

  // Re-resolve the live URL whenever the sheet opens or the build flips to
  // ready. We don't subscribe directly because `useBuildActivity` already
  // pushes us re-renders, and the resolve call is cheap (two indexed reads).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const r = await resolvePublishedUrl(
        project.id,
        project.primary_domain_id,
        project.latest_build_id,
      );
      if (!cancelled) setResolved(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    project.id,
    project.primary_domain_id,
    project.latest_build_id,
    buildSnap?.status,
    buildSnap?.distPath,
  ]);

  const status = buildSnap?.status ?? null;
  const hasEverPublished = !!resolved.url;
  const buildError = buildSnap?.errorMessage ?? null;

  async function copyUrl() {
    if (!resolved.url) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(resolved.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy link");
    } finally {
      setCopying(false);
    }
  }

  async function publishNow() {
    setPublishing(true);
    try {
      await triggerBuild(project.id);
      toast.success("Publishing your changes…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't publish");
    } finally {
      setPublishing(false);
    }
  }

  async function toggleVisibility(next: boolean) {
    setVisibilityBusy(true);
    try {
      const updated = await updateProject(project.id, { is_public: next });
      onChange(updated);
      toast.success(next ? "Anyone with the URL can view this app" : "Only you can view this app");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update visibility");
    } finally {
      setVisibilityBusy(false);
    }
  }

  // CTA state machine — keeps the button label/icon honest with the build.
  const cta = (() => {
    if (publishing || status === "pending") {
      return {
        label: hasEverPublished ? "Publishing update…" : "Publishing…",
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        disabled: true,
        tone: "primary" as const,
      };
    }
    if (status === "failed") {
      return {
        label: "Retry publish",
        icon: <AlertCircle className="h-4 w-4" />,
        disabled: false,
        tone: "destructive" as const,
      };
    }
    if (status === "ready" && hasEverPublished) {
      return {
        label: "Up to date",
        icon: <CheckCircle2 className="h-4 w-4" />,
        disabled: false,
        tone: "success" as const,
      };
    }
    return {
      label: hasEverPublished ? "Publish update" : "Publish",
      icon: <Globe className="h-4 w-4" />,
      disabled: false,
      tone: "primary" as const,
    };
  })();

  const ctaClasses =
    cta.tone === "destructive"
      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      : cta.tone === "success"
        ? "bg-primary/15 text-primary hover:bg-primary/20"
        : "bg-primary text-primary-foreground hover:bg-primary/90";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <DrawerTitle className="sr-only">Publish</DrawerTitle>

        {/* Header */}
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {hasEverPublished ? "Published" : "Not published yet"}
            </h2>
            {hasEverPublished && resolved.source === "deployment" && (
              <p className="text-xs text-muted-foreground">
                Live on the Petal subdomain
              </p>
            )}
            {hasEverPublished && resolved.source === "custom_domain" && (
              <p className="text-xs text-muted-foreground">
                Live on your custom domain
              </p>
            )}
          </div>
          {status === "pending" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Publishing
            </span>
          )}
          {status === "failed" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <AlertCircle className="h-3 w-3" />
              Failed
            </span>
          )}
          {status === "ready" && hasEverPublished && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Live
            </span>
          )}
        </div>

        {/* Website URL */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Website URL</span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onManageDomains();
              }}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <Link2 className="h-3.5 w-3.5" />
              Manage domains
            </button>
          </div>
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-xl border border-border bg-card px-3 py-2.5">
              <span className="truncate text-sm text-foreground">
                {resolved.display ?? "Will appear after first publish"}
              </span>
            </div>
            <button
              type="button"
              onClick={copyUrl}
              disabled={!resolved.url || copying}
              className="grid h-auto w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition hover:bg-muted disabled:opacity-40"
              aria-label="Copy URL"
            >
              {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            </button>
            {resolved.url && (
              <a
                href={resolved.url}
                target="_blank"
                rel="noreferrer"
                className="grid h-auto w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition hover:bg-muted"
                aria-label="Open in new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>

        {/* Visibility */}
        <div className="mt-5 space-y-2">
          <span className="text-sm font-medium">Who can see this website</span>
          <div className="grid grid-cols-2 gap-2">
            <VisibilityChoice
              active={project.is_public}
              icon={<Globe className="h-4 w-4" />}
              title="Public"
              subtitle="Anyone with the URL"
              busy={visibilityBusy}
              onClick={() => !project.is_public && toggleVisibility(true)}
            />
            <VisibilityChoice
              active={!project.is_public}
              icon={<Lock className="h-4 w-4" />}
              title="Private"
              subtitle="Only you"
              busy={visibilityBusy}
              onClick={() => project.is_public && toggleVisibility(false)}
            />
          </div>
        </div>

        {/* Build error (only when relevant) */}
        {status === "failed" && buildError && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <span className="font-medium">Last publish failed.</span>{" "}
            <span className="opacity-80">
              {buildError.split("\n").slice(-1)[0]?.slice(0, 200) ?? "Unknown error"}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 grid grid-cols-1 gap-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onOpenSettings();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              <SettingsIcon className="h-4 w-4" />
              Edit settings
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onManageDomains();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              <Globe className="h-4 w-4" />
              Custom domain
            </button>
          </div>
          <button
            type="button"
            onClick={publishNow}
            disabled={cta.disabled}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${ctaClasses} disabled:cursor-not-allowed disabled:opacity-90`}
          >
            {cta.icon}
            {cta.label}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function VisibilityChoice({
  active,
  icon,
  title,
  subtitle,
  busy,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || active}
      className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
        active
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-card hover:bg-muted"
      } disabled:cursor-default`}
    >
      <span
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
          active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  );
}
