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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";

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
  
  BarChart3,
  Pencil,
  X,
  Search,
} from "lucide-react";
import { WebsiteInfoSheet } from "@/components/WebsiteInfoSheet";
import { PublishingCard, PublishSuccessCard } from "@/components/PublishSuccessCard";

import { supabase } from "@/integrations/supabase/client";
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
  const isMobile = useIsMobile();
  const buildSnap = useBuildActivity(project.latest_build_id ?? null);

  const [resolved, setResolved] = useState<PublishedUrlResult>({
    url: null,
    source: "none",
    display: null,
  });
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [websiteInfoOpen, setWebsiteInfoOpen] = useState(false);

  // Visitor analytics — database-backed traffic for the project's published site.
  // We fetch on open/range changes and subscribe to the daily rollup so the
  // count updates as new visits are recorded.
  const [visitorRange, setVisitorRange] = useState<VisitorRange>("7d");
  const [visitors, setVisitors] = useState<VisitorStatsResult | null>(null);
  const [visitorsLoading, setVisitorsLoading] = useState(false);

  // Petal subdomain (`<slug>.buildwithpetal.com`) — claim/edit flow. The
  // slug lives on `projects.subdomain`; we keep a local draft for the
  // input and debounce availability checks against /api/subdomain.
  const currentSlug = (project as ProjectRow & { subdomain: string | null }).subdomain ?? null;
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState<string>("");
  const [slugCheck, setSlugCheck] = useState<CheckResult | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugClaiming, setSlugClaiming] = useState(false);
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fresh state every time the sheet opens — the celebration is for the
  // publish that just happened, not the one from an hour ago.
  useEffect(() => {
    if (!open) setJustPublished(false);
  }, [open]);

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

  const loadVisitors = useCallback(
    async (signal?: AbortSignal) => {
      if (!hasPublishedBuild) {
        setVisitors(null);
        return;
      }
      setVisitorsLoading(true);
      try {
        const stats = await fetchProjectVisitors({
          projectId: project.id,
          range: visitorRange,
          signal,
        });
        if (!signal?.aborted) setVisitors(stats);
      } catch (e) {
        if (signal?.aborted) return;
        setVisitors({
          visitors: 0,
          pageviews: 0,
          range: visitorRange,
          since: null,
          until: null,
          unavailable: true,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        if (!signal?.aborted) setVisitorsLoading(false);
      }
    },
    [hasPublishedBuild, project.id, visitorRange],
  );

  // Fetch visitor counts when the sheet opens (and when the user flips the
  // time range). Aborts on close so a slow analytics call can't update closed
  // sheet state.
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    void loadVisitors(ac.signal);
    return () => ac.abort();
  }, [open, loadVisitors, project.published_build_id]);

  useEffect(() => {
    if (!open || !hasPublishedBuild) return;
    const channel = supabase
      .channel(`project-visitors-${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "page_views_daily",
          filter: `project_id=eq.${project.id}`,
        },
        () => void loadVisitors(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, hasPublishedBuild, project.id, loadVisitors]);


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
      setJustPublished(true);
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

  /* ---------------- Petal subdomain (slug) flow ---------------- */

  // Open the editor with a sensible default: keep what's there, or suggest
  // one from the project title.
  function startEditingSlug() {
    const initial = currentSlug ?? suggestSlugFromTitle(project.title);
    setSlugDraft(initial);
    setSlugCheck(null);
    setEditingSlug(true);
  }

  function cancelEditingSlug() {
    setEditingSlug(false);
    setSlugDraft("");
    setSlugCheck(null);
    if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
  }

  // Debounced availability check while the user types. Skips the network
  // call when the draft equals the currently-claimed slug (always "ours").
  useEffect(() => {
    if (!editingSlug) return;
    if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
    if (!slugDraft) {
      setSlugCheck(null);
      return;
    }
    if (slugDraft === currentSlug) {
      setSlugCheck({
        available: true,
        reason: null,
        hostname: `${slugDraft}.${PETAL_ROOT_DOMAIN}`,
      });
      return;
    }
    setSlugChecking(true);
    slugDebounceRef.current = setTimeout(async () => {
      try {
        const result = await checkSubdomain(project.id, slugDraft);
        setSlugCheck(result);
      } catch (e) {
        setSlugCheck({
          available: false,
          reason: e instanceof Error ? e.message : "Couldn't check availability",
        });
      } finally {
        setSlugChecking(false);
      }
    }, 350);
    return () => {
      if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
    };
  }, [slugDraft, editingSlug, currentSlug, project.id]);

  async function saveSlug() {
    if (!slugCheck?.available) return;
    setSlugClaiming(true);
    try {
      const result = await claimPetalSubdomain(project.id, slugDraft);
      // Optimistic local update — keeps the URL row in sync without a refetch.
      onChange({
        ...project,
        subdomain: result.slug,
      } as ProjectRow);
      toast.success(
        currentSlug
          ? `Subdomain updated to ${result.hostname}`
          : `Your app is reachable at ${result.hostname}`,
      );
      setEditingSlug(false);
      // Re-resolve the displayed URL since priority just changed.
      const r = await resolvePublishedUrl(
        project.id,
        project.primary_domain_id,
        project.latest_build_id,
      );
      setResolved(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't claim subdomain");
    } finally {
      setSlugClaiming(false);
    }
  }

  // Pretty hostname preview for the input row (always reflects the draft).
  const slugPreviewHostname = useMemo(
    () => (slugDraft ? `${slugDraft}.${PETAL_ROOT_DOMAIN}` : `your-slug.${PETAL_ROOT_DOMAIN}`),
    [slugDraft],
  );

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

  const siteMeta = project as ProjectRow & {
    site_title?: string | null;
    site_description?: string | null;
    site_icon_url?: string | null;
  };

  // Lovable-style focused states: while we're pushing (or right after we
  // finished) the sheet shows ONLY that moment — no settings list behind it.
  const isBusyPublishing = (publishing || buildStatus === "pending") && !justPublished;
  const showSuccess = justPublished && !publishing;

  const content = isBusyPublishing ? (
    <PublishingCard isUpdate={hasPublishedBuild} />
  ) : showSuccess ? (
    <PublishSuccessCard
      isUpdate={hasPublishedBuild && !isUnpublished}
      url={resolved.url}
      display={resolved.display}
      title={siteMeta.site_title || project.title}
      description={siteMeta.site_description ?? project.summary}
      iconUrl={siteMeta.site_icon_url}
      onEditWebsiteInfo={() => setWebsiteInfoOpen(true)}
      onDismiss={() => setJustPublished(false)}
    />
  ) : (
    <>





        {/* Header */}
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">
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
          <div className="flex items-center gap-2">
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

            {/* Inline visitor pill — quietly sits in the header so it never
                competes with the publish status. Tap to cycle the range. */}
            {hasPublishedBuild && (
              <button
                type="button"
                onClick={() =>
                  setVisitorRange((r) => (r === "24h" ? "7d" : r === "7d" ? "30d" : "24h"))
                }
                disabled={visitorsLoading}
                title={`Visitors · last ${
                  visitorRange === "24h" ? "24 hours" : visitorRange === "7d" ? "7 days" : "30 days"
                } (tap to change)`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                {visitorsLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : visitors?.unavailable ? (
                  <span>Visitors unavailable</span>
                ) : (
                  <span>
                    <span className="tabular-nums font-medium text-foreground">
                      {(visitors?.visitors ?? 0).toLocaleString()}
                    </span>{" "}
                    Visitor{(visitors?.visitors ?? 0) === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Website URL — combined card holding both the primary URL and the
            Petal subdomain. We collapse the two into one block so the sheet
            stays scannable: primary URL on top, subdomain row underneath when
            it differs from the primary (or is being claimed/edited). */}
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

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* Primary URL row */}
            <div className="flex items-stretch">
              <div className="flex min-w-0 flex-1 items-center px-3 py-2.5">
                <span className="truncate text-sm text-foreground">
                  {resolved.display ?? "Will appear after first publish"}
                </span>
              </div>
              <button
                type="button"
                onClick={copyUrl}
                disabled={!resolved.url || copying}
                className="grid w-11 shrink-0 place-items-center border-l border-border text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                aria-label="Copy URL"
              >
                {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </button>
              {resolved.url && (
                <a
                  href={resolved.url}
                  target="_blank"
                  rel="noreferrer"
                  className="grid w-11 shrink-0 place-items-center border-l border-border text-muted-foreground transition hover:bg-muted"
                  aria-label="Open in new tab"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>

            {/* Petal subdomain — secondary row inside the same card.
                Skip it when the primary URL already IS the petal subdomain
                (i.e. there's no custom domain), unless the user is editing. */}
            {(() => {
              const primaryIsPetal =
                resolved.source === "deployment" ||
                (currentSlug && resolved.display === `${currentSlug}.${PETAL_ROOT_DOMAIN}`);
              const showSubRow = editingSlug || !primaryIsPetal || !currentSlug;
              if (!showSubRow) {
                // Primary URL is the petal subdomain — offer a quiet "Change"
                // affordance so users can still rename it without a second row.
                return (
                  <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                      Petal subdomain claimed
                    </span>
                    <button
                      type="button"
                      onClick={startEditingSlug}
                      className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                      Change
                    </button>
                  </div>
                );
              }
              return (
                <div className="border-t border-border">
                  {!editingSlug && currentSlug && (
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="truncate text-sm">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          Petal subdomain ·{" "}
                        </span>
                        <span className="font-medium text-foreground">{currentSlug}</span>
                        <span className="text-muted-foreground">.{PETAL_ROOT_DOMAIN}</span>
                      </span>
                      <button
                        type="button"
                        onClick={startEditingSlug}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                        Change
                      </button>
                    </div>
                  )}

                  {!editingSlug && !currentSlug && (
                    <button
                      type="button"
                      onClick={startEditingSlug}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left transition hover:bg-muted"
                    >
                      <span className="text-sm">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                          Petal subdomain ·{" "}
                        </span>
                        <span className="font-medium text-foreground">your-slug</span>
                        <span className="text-muted-foreground">.{PETAL_ROOT_DOMAIN}</span>
                      </span>
                      <span className="text-xs font-medium text-primary">Claim</span>
                    </button>
                  )}

                  {editingSlug && (
                    <div className="space-y-2 p-2">
                      <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-background focus-within:border-primary/60">
                        <input
                          type="text"
                          inputMode="url"
                          autoFocus
                          value={slugDraft}
                          onChange={(e) =>
                            setSlugDraft(
                              e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9-]/g, "")
                                .slice(0, 40),
                            )
                          }
                          placeholder="your-slug"
                          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60"
                          aria-label="Petal subdomain slug"
                        />
                        <span className="flex shrink-0 items-center px-3 text-sm text-muted-foreground">
                          .{PETAL_ROOT_DOMAIN}
                        </span>
                        <button
                          type="button"
                          onClick={cancelEditingSlug}
                          disabled={slugClaiming}
                          className="grid w-10 shrink-0 place-items-center border-l border-border text-muted-foreground transition hover:bg-muted disabled:opacity-40"
                          aria-label="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="flex min-h-[1.25rem] items-center gap-1.5 px-1 text-xs">
                        {slugChecking && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Checking…
                          </span>
                        )}
                        {!slugChecking && slugCheck?.available && (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <CheckCircle2 className="h-3 w-3" />
                            {slugDraft === currentSlug
                              ? "This is your current subdomain"
                              : `${slugPreviewHostname} is available`}
                          </span>
                        )}
                        {!slugChecking && slugCheck && !slugCheck.available && (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            {slugCheck.reason ?? "Not available"}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={saveSlug}
                        disabled={
                          !slugCheck?.available ||
                          slugClaiming ||
                          slugDraft === currentSlug
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {slugClaiming ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Claiming…
                          </>
                        ) : (
                          <>
                            <Globe className="h-4 w-4" />
                            {currentSlug ? "Update subdomain" : "Claim subdomain"}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
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

        {/* Website info — title / description / favicon / social image used
            by the subdomain worker to render <head> tags on the published
            site. Defaults to the project's build-time title/summary and the
            Petal logo until the user customises any of it. */}
        <button
          type="button"
          onClick={() => setWebsiteInfoOpen(true)}
          className="mt-5 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:bg-muted"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Search className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Website info</span>
            <span className="block truncate text-xs text-muted-foreground">
              {(project.site_title?.trim() || project.title) ?? "Add a title and description"}
            </span>
          </span>
          <Pencil className="h-4 w-4 text-muted-foreground" />
        </button>

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
    </>
  );

  return (
    <>
      {isMobile === false ? (
        // Desktop: a compact panel anchored under the Publish button, like
        // Lovable's popover — never a full-height drawer.
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            className="left-auto right-4 top-16 max-h-[min(78vh,640px)] w-[380px] max-w-[calc(100vw-2rem)] translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-2xl p-4 text-[13px] shadow-xl data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-2 sm:max-w-[380px] sm:rounded-2xl"
          >
            <DialogTitle className="sr-only">Publish</DialogTitle>
            {content}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <DrawerTitle className="sr-only">Publish</DrawerTitle>
            {content}
          </DrawerContent>
        </Drawer>
      )}
      <WebsiteInfoSheet
        open={websiteInfoOpen}
        onOpenChange={setWebsiteInfoOpen}
        project={project}
        onChange={onChange}
      />
    </>

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
