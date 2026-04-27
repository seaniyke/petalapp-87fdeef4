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
import { useEffect, useMemo, useRef, useState } from "react";
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
  Users,
  Pencil,
  X,
} from "lucide-react";
import { triggerBuild } from "@/lib/builds";
import { publishProject, type PublishVisibility } from "@/lib/publish";
import { resolvePublishedUrl, type PublishedUrlResult } from "@/lib/published-url";
import { type ProjectRow } from "@/lib/projects";
import { useBuildActivity } from "@/hooks/use-build-activity";
import {
  fetchProjectVisitors,
  type VisitorRange,
  type VisitorStatsResult,
} from "@/lib/visitors";
import {
  PETAL_ROOT_DOMAIN,
  checkSubdomain,
  claimSubdomain as claimPetalSubdomain,
  suggestSlugFromTitle,
  type CheckResult,
} from "@/lib/petal-subdomain";
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
  // Visitor analytics — Cloudflare Pages traffic for the project's site.
  // We fetch on open and when the user flips the range, never poll.
  const [visitorRange, setVisitorRange] = useState<VisitorRange>("7d");
  const [visitors, setVisitors] = useState<VisitorStatsResult | null>(null);
  const [visitorsLoading, setVisitorsLoading] = useState(false);

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

  const buildStatus = buildSnap?.status ?? null;
  const buildError = buildSnap?.errorMessage ?? null;

  // Phase 2 derived state — preview vs published.
  const visibility = (project.published_visibility ?? "unpublished") as PublishVisibility;
  const hasPublishedBuild = !!project.published_build_id;
  const isUnpublished = visibility === "unpublished" || !hasPublishedBuild;
  const updateAvailable =
    hasPublishedBuild &&
    !!project.latest_build_id &&
    project.latest_build_id !== project.published_build_id &&
    buildStatus === "ready";
  const hasUrl = !!resolved.url;

  // Fetch Cloudflare visitor counts when the sheet opens (and when the
  // user flips the time range). Skipped for never-published projects since
  // /api/visitors short-circuits to zero anyway. Aborts on close so a slow
  // analytics call can't update closed-sheet state.
  useEffect(() => {
    if (!open) return;
    if (!hasPublishedBuild) {
      setVisitors(null);
      return;
    }
    const ac = new AbortController();
    setVisitorsLoading(true);
    fetchProjectVisitors({
      projectId: project.id,
      range: visitorRange,
      signal: ac.signal,
    })
      .then((stats) => {
        if (!ac.signal.aborted) setVisitors(stats);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        // Match the server's soft-fail shape so the UI logic is uniform.
        setVisitors({
          visitors: 0,
          pageviews: 0,
          range: visitorRange,
          since: null,
          until: null,
          unavailable: true,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      })
      .finally(() => {
        if (!ac.signal.aborted) setVisitorsLoading(false);
      });
    return () => ac.abort();
  }, [open, project.id, hasPublishedBuild, visitorRange, project.published_build_id]);


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

  /**
   * Publish (or re-publish) the project. Pins the current latest ready build
   * as the published build via /api/publish. If the latest build is still
   * pending or failed we kick off a fresh build first so the user gets a
   * single "Publish" interaction instead of two.
   */
  async function publishNow() {
    setPublishing(true);
    try {
      // No build yet at all → trigger one. The user can publish once it's ready.
      if (!project.latest_build_id) {
        await triggerBuild(project.id);
        toast.success("Building your app — publish will be available when it's ready.");
        return;
      }
      // Latest build failed → retry the build first.
      if (buildStatus === "failed") {
        await triggerBuild(project.id);
        toast.success("Retrying the build…");
        return;
      }
      // Latest build still pending → wait it out.
      if (buildStatus === "pending") {
        toast.info("A build is already in progress — publish will be available when it finishes.");
        return;
      }
      // Latest build is ready → pin it as published.
      const result = await publishProject({ projectId: project.id });
      onChange({ ...project, ...result.project } as ProjectRow);
      toast.success(isUnpublished ? "Your app is live 🎉" : "Update published");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't publish");
    } finally {
      setPublishing(false);
    }
  }

  async function changeVisibility(next: PublishVisibility) {
    if (visibility === next) return;
    setVisibilityBusy(true);
    try {
      const result = await publishProject({
        projectId: project.id,
        visibility: next,
        // Don't pin a new build just because they flipped visibility.
        pinLatestBuild: false,
      });
      onChange({ ...project, ...result.project } as ProjectRow);
      const message =
        next === "public"
          ? "Anyone with the URL can view your app"
          : next === "private"
            ? "Only your workspace can view your app"
            : "Your app is no longer public";
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update visibility");
    } finally {
      setVisibilityBusy(false);
    }
  }

  // CTA state machine — keeps the button label/icon honest with the build.
  const cta = (() => {
    if (publishing || buildStatus === "pending") {
      return {
        label: hasPublishedBuild ? "Publishing update…" : "Publishing…",
        icon: <Loader2 className="h-4 w-4 animate-spin" />,
        disabled: true,
        tone: "primary" as const,
      };
    }
    if (buildStatus === "failed") {
      return {
        label: "Retry publish",
        icon: <AlertCircle className="h-4 w-4" />,
        disabled: false,
        tone: "destructive" as const,
      };
    }
    if (updateAvailable) {
      return {
        label: "Update",
        icon: <Globe className="h-4 w-4" />,
        disabled: false,
        tone: "primary" as const,
      };
    }
    if (hasPublishedBuild && buildStatus === "ready") {
      return {
        label: "Up to date",
        icon: <CheckCircle2 className="h-4 w-4" />,
        disabled: true,
        tone: "success" as const,
      };
    }
    return {
      label: "Publish",
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
              {isUnpublished
                ? "Not published yet"
                : visibility === "private"
                  ? "Published privately"
                  : "Published"}
            </h2>
            {hasPublishedBuild && resolved.source === "deployment" && (
              <p className="text-xs text-muted-foreground">Live on the Petal subdomain</p>
            )}
            {hasPublishedBuild && resolved.source === "custom_domain" && (
              <p className="text-xs text-muted-foreground">Live on your custom domain</p>
            )}
            {isUnpublished && (
              <p className="text-xs text-muted-foreground">
                Publish when you're ready to share with the world.
              </p>
            )}
          </div>
          {buildStatus === "pending" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              Publishing
            </span>
          )}
          {buildStatus === "failed" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <AlertCircle className="h-3 w-3" />
              Failed
            </span>
          )}
          {!publishing && buildStatus !== "pending" && buildStatus !== "failed" && updateAvailable && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              Update available
            </span>
          )}
          {!publishing && buildStatus === "ready" && hasPublishedBuild && !updateAvailable && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              <CheckCircle2 className="h-3 w-3" />
              Live
            </span>
          )}
        </div>

        {/* Visitor count — only renders for published projects. */}
        {hasPublishedBuild && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70">
                <Users className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {visitorsLoading ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading…
                    </span>
                  ) : visitors?.unavailable ? (
                    <span className="text-muted-foreground">Visitors unavailable</span>
                  ) : (
                    <>
                      <span className="tabular-nums">
                        {(visitors?.visitors ?? 0).toLocaleString()}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        visitor{(visitors?.visitors ?? 0) === 1 ? "" : "s"}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {visitors?.unavailable
                    ? "Cloudflare analytics didn't respond — try again in a moment."
                    : `${(visitors?.pageviews ?? 0).toLocaleString()} pageview${(visitors?.pageviews ?? 0) === 1 ? "" : "s"} · last ${visitorRange === "24h" ? "24 hours" : visitorRange === "7d" ? "7 days" : "30 days"}`}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-lg bg-muted p-0.5 text-[11px]">
              {(["24h", "7d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setVisitorRange(r)}
                  disabled={visitorsLoading}
                  className={`rounded-md px-2 py-1 font-medium transition ${
                    visitorRange === r
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-50`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

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
              active={visibility === "public"}
              icon={<Globe className="h-4 w-4" />}
              title="Public"
              subtitle="Anyone with the URL"
              busy={visibilityBusy}
              onClick={() => changeVisibility("public")}
            />
            <VisibilityChoice
              active={visibility === "private"}
              icon={<Lock className="h-4 w-4" />}
              title="Private"
              subtitle="Only your workspace"
              busy={visibilityBusy}
              onClick={() => changeVisibility("private")}
            />
          </div>
          {hasPublishedBuild && (
            <button
              type="button"
              onClick={() => changeVisibility("unpublished")}
              disabled={visibilityBusy}
              className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-40"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Unpublish this site
            </button>
          )}
        </div>

        {/* Build error (only when relevant) */}
        {buildStatus === "failed" && buildError && (
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
