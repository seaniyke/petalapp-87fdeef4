import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Menu,
  Send,
  Loader2,
  FileCode2,
  Eye,
  Code2,
  Sparkles,
  RotateCw,
  Download,
  FolderOpen,
  Command as CommandIcon,
  RefreshCcw,
  MessageSquare,
  Hammer,
  Wand2,
  Undo2,
  X,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Smartphone,
  Tablet,
  Monitor,
  Paperclip,
  ImageIcon,
  Globe,
  FileText,
  Shield,
} from "lucide-react";
import {
  encodeAttachments,
  type ChatAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/attachments";
import { streamGenerate } from "@/lib/stream";
import { streamTriage } from "@/lib/triage";
import { requestDiscussion } from "@/lib/discuss";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBuildActivity } from "@/hooks/use-build-activity";
import { useAuthReady } from "@/lib/auth";
import { detectUnsupportedWebContainerBrowser } from "@/lib/browser-support";
import {
  type Phase,
  type PhaseId,
  advanceTo,
  completeThrough,
  defaultPhases,
  markFailed,
} from "@/lib/build-phases";
import {
  autoFixingBuild,
  friendlyBuildFailure,
  toFriendlyError,
  type FriendlyError,
} from "@/lib/friendly-errors";
import { BuildActivityCard } from "@/components/BuildActivityCard";


import {
  appendMessages,
  createProject,
  getProject,
  loadProjectFiles,
  loadProjectMessages,
  maybeAutoTitleProject,
  saveProjectFiles,
  truncateMessagesToCount,
  type ProjectRow,
} from "@/lib/projects";
import {
  clearMessageDraft,
  createDraftWriter,
  loadMessageDraft,
} from "@/lib/message-drafts";
import {
  builderDraftKeys,
  clearDraft,
  readDraft,
  writeDraft,
} from "@/lib/draft-storage";
import { createVersion, listVersions } from "@/lib/versions";
import { triggerBuild } from "@/lib/builds";
import { supabase } from "@/integrations/supabase/client";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SharePopover } from "@/components/SharePopover";
import { ProjectSettingsSheet } from "@/components/ProjectSettingsSheet";
import { RevertPreviewDialog } from "@/components/RevertPreviewDialog";
import { BuilderActionsSheet } from "@/components/BuilderActionsSheet";
import { PublishSheet } from "@/components/PublishSheet";
import { RenameProjectDialog } from "@/components/RenameProjectDialog";
import { BillingSheet } from "@/components/BillingSheet";
import { ProjectsDrawer } from "@/components/ProjectsDrawer";
import { RuntimeLowBalanceBanner } from "@/components/RuntimeLowBalanceBanner";
import { EnableBackendSuggestionChip } from "@/components/EnableBackendSuggestionChip";
import { PreflightCostChip } from "@/components/PreflightCostChip";
import { PetalShieldSheet } from "@/components/PetalShieldSheet";
import { ReadinessBadge } from "@/components/ReadinessBadge";
import { detectBackendIntentInTurn } from "@/lib/backend-intent";
import { getProjectBackend } from "@/lib/projects";
import { useWallet } from "@/hooks/use-wallet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// Lazy: keep CodeMirror, cmdk, react-markdown, rehype-highlight out of the
// initial /builder bundle. Most users see Preview first.
const CodeEditor = lazy(() =>
  import("@/components/CodeEditor").then((m) => ({ default: m.CodeEditor })),
);
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const MarkdownMessage = lazy(() =>
  import("@/components/MarkdownMessage").then((m) => ({ default: m.MarkdownMessage })),
);
import { CollapsibleSegment } from "@/components/CollapsibleSegment";
import { sanitizeNarrative } from "@/lib/sanitize-narrative";
const WebContainerPreview = lazy(() =>
  import("@/components/WebContainerPreview").then((m) => ({ default: m.WebContainerPreview })),
);
const MobilePreviewFallback = lazy(() =>
  import("@/components/MobilePreviewFallback").then((m) => ({ default: m.MobilePreviewFallback })),
);
const FirstRunTour = lazy(() =>
  import("@/components/FirstRunTour").then((m) => ({ default: m.FirstRunTour })),
);

// Detect once on the client whether this browser can run a WebContainer.
// Mirrors the same logic as the inner component but lets us route to the
// deployed-iframe fallback BEFORE we even mount WebContainerPreview, so iOS
// and other unsupported browsers see the same live preview that mobile gets.
function useWebContainerSupported(): boolean {
  const [supported, setSupported] = useState<boolean>(false);
  useEffect(() => {
    setSupported(detectUnsupportedWebContainerBrowser() === null);
  }, []);
  return supported;
}
type PaletteItem = import("@/components/CommandPalette").PaletteItem;

export const Route = createFileRoute("/builder")({
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
    id: typeof search.id === "string" ? search.id : undefined,
    mode: search.mode === "discuss" ? ("discuss" as const) : undefined,
    /** sessionStorage key holding ChatAttachment[] stashed by the landing page. */
    attachKey: typeof search.attachKey === "string" ? search.attachKey : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Builder · Petal" },
      { name: "description", content: "Chat with Petal to build a working web app." },
    ],
  }),
  component: Builder,
});

type ViewMode = "preview" | "code";

function Builder() {
  const { prompt: initialPrompt, id: searchId, mode: initialMode, attachKey } = Route.useSearch();
  const { user, isReady } = useAuthReady();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("preview");
  const [previewKey, setPreviewKey] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);
  const [phases, setPhases] = useState<Phase[]>(defaultPhases);
  const [designCaption, setDesignCaption] = useState<string>("");
  const [filesWritten, setFilesWritten] = useState<number>(0);
  const [lastBuildCredits, setLastBuildCredits] = useState<number | null>(null);
  const [latestPath, setLatestPath] = useState<string | undefined>(undefined);
  // Ordered, deduped list of every path Petal streams during the writing phase.
  // Drives the per-file progress list in BuildActivityCard.
  const [writtenPaths, setWrittenPaths] = useState<string[]>([]);
  // Final per-file line counts, populated after a successful run.
  const [finalFileLines, setFinalFileLines] = useState<Record<string, number>>({});
  // Per-file change summary computed against the pre-run snapshot. Drives the
  // "added/modified/deleted" badges and ±line deltas under the writing phase.
  // Empty object until a run completes successfully.
  const [fileChanges, setFileChanges] = useState<
    Record<
      string,
      { kind: "added" | "modified" | "unchanged" | "deleted"; addedLines: number; removedLines: number }
    >
  >({});
  // Live, token-by-token assistant reply rendered in the chat thread while busy.
  // This mirrors what Lovable/Bolt/v0 do — the user sees Petal "talking" in real
  // time, not just a structured timeline. Cleared when the run completes.
  const [streamingAssistant, setStreamingAssistant] = useState<string>("");
  // Structured streaming segments — render alongside the live summary so the
  // user sees: Plan → Activity → Recap (Lovable / Bolt / v0 parity).
  const [streamingPlan, setStreamingPlan] = useState<string>("");
  const [streamingRecap, setStreamingRecap] = useState<string>("");
  // Conversational preamble streamed BEFORE any build work — the warm,
  // human "Got it, here's what I'll do" reply that competitors (Lovable,
  // Bolt, v0) say before showing any phase indicators. Comes from /api/triage.
  const [streamingPreamble, setStreamingPreamble] = useState<string>("");
  // Whether the current send() turn is actually going to build (vs. just
  // chat or ask a clarifying question). Drives whether the activity card
  // and build pipeline UI render at all.
  const [intentBuild, setIntentBuild] = useState<boolean>(false);
  // Preview device frame: phone | tablet | desktop. Affects only the wrapper
  // around WebContainerPreview / MobilePreviewFallback — they get the iframe
  // sized to a realistic device width so users can spot responsive issues.
  const [previewDevice, setPreviewDevice] = useState<"phone" | "tablet" | "desktop">("desktop");
  const [activityVisible, setActivityVisible] = useState(false);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState<string | null>(null);
  // Build vs Discuss mode. Discuss = chat-only, no file changes (Base44/Lovable parity).
  const [mode, setMode] = useState<"build" | "discuss">(initialMode === "discuss" ? "discuss" : "build");
  // Smart model routing is always on. The /api/generate endpoint auto-picks
  // Pro for big/complex changes and Flash otherwise — users shouldn't choose.
  // Index of the most recent assistant message that came from Discuss mode,
  // so we can render an "Apply this plan" button under it.
  const [lastDiscussIndex, setLastDiscussIndex] = useState<number | null>(null);
  const [discussBusy, setDiscussBusy] = useState(false);
  // Message queue: prompts the user types while Petal is busy. Each entry
  // remembers which mode it was queued in so the dispatch is faithful.
  type QueuedMessage = { id: string; text: string; mode: "build" | "discuss" };
  const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([]);
  // Per-message revert: which user-message index is being reverted (for spinner).
  const [revertingIndex, setRevertingIndex] = useState<number | null>(null);
  const [revertPreview, setRevertPreview] = useState<{
    userMsgIndex: number;
    userOrdinal: number;
    targetFiles: ProjectFile[];
    label: string;
  } | null>(null);
  const [revertPreparing, setRevertPreparing] = useState<number | null>(null);
  // Mobile-only: which panel is visible. On desktop both render side-by-side.
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  // Project Knowledge sheet — also opens from the mobile overflow menu.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsScrollTo, setSettingsScrollTo] = useState<
    "domains" | "backend" | "knowledge" | null
  >(null);
  // Mobile builder menu (bottom sheet) + dependent dialogs.
  const [actionsOpen, setActionsOpen] = useState(false);
  const [projectsDrawerOpen, setProjectsDrawerOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [shieldOpen, setShieldOpen] = useState(false);
  // Whether this project already has a backend (BYO or managed). When unknown
  // we treat as "not connected" but suppress the chip until we've checked.
  const [hasBackend, setHasBackend] = useState<boolean | null>(null);
  // Per-message dismissal of the "Add backend" inline suggestion. Keyed by
  // assistant message index so dismissing once doesn't kill it forever.
  const [dismissedBackendChips, setDismissedBackendChips] = useState<Set<number>>(
    () => new Set(),
  );
  const { plan: currentPlan } = useWallet();
  const isPaidPlan = !!currentPlan && currentPlan.code !== "free";
  const [previewHasUpdate, setPreviewHasUpdate] = useState(false);
  // Visual element edit (Phase 5): selected element from the preview iframe.
  type PickedElement = {
    tag: string;
    id: string | null;
    classes: string | null;
    text: string;
    role: string | null;
    ariaLabel: string | null;
    sourceFile: string | null;
    sourceLine: string | null;
  };
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null);
  const [pickInstruction, setPickInstruction] = useState("");
  // Composer attachments — encoded images that ride along with the next prompt.
  // Cleared after each send. The `initialAttachments` ref holds attachments
  // stashed by the landing page (via sessionStorage attachKey) until the
  // first auto-send consumes them.
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const initialAttachmentsRef = useRef<ChatAttachment[]>([]);
  const composerFileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const webContainerSupported = useWebContainerSupported();
  // Use the deployed-build iframe fallback whenever WebContainers can't run
  // here — narrow viewport (mobile) OR an unsupported browser (iOS Safari,
  // Android non-Chromium, no SharedArrayBuffer, etc.).
  const useDeployedFallback = isMobile || !webContainerSupported;
  const initialSent = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Phase 2 (auto-fix): when a build fails, Petal automatically reads the log
  // and sends a fix prompt — capped at 2 attempts per build id so we never
  // get stuck in a loop. After the cap we fall back to the manual
  // "Ask Petal to fix it" button (friendlyBuildFailure).
  const MAX_AUTO_FIX_ATTEMPTS = 2;
  const autoFixRef = useRef<{ buildId: string | null; attempts: number }>({
    buildId: null,
    attempts: 0,
  });
  // Stable handle to the latest askPetalToFix so the failure effect (declared
  // before send/askPetalToFix) can call it without stale-closure issues.
  const askPetalToFixRef = useRef<(() => void) | null>(null);
  // Phase 3 — track the build id we last surfaced an "Update available" toast
  // for, so a single ready build only nudges the user once.
  const pushUpdateToastedBuildIdRef = useRef<string | null>(null);

  // Pick up attachments stashed by the landing page (sessionStorage),
  // exactly once per attachKey. Drop them from storage so a refresh
  // doesn't re-attach them.
  useEffect(() => {
    if (!attachKey || typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(attachKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ChatAttachment[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        initialAttachmentsRef.current = parsed.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
      }
      sessionStorage.removeItem(attachKey);
    } catch {
      /* ignore — stale or corrupt */
    }
  }, [attachKey]);

  // Subscribe to the live Cloudflare build for this project so we can fold
  // its status into the activity feed seamlessly with AI generation.
  const buildSnap = useBuildActivity(project?.latest_build_id ?? null);
  // 'pending' = queued, 'building' = Railway picked it up. Both keep the
  // activity card in its "deploying" phase. Treating 'building' as inactive
  // (the previous behavior, since it wasn't in the enum) was the bug that
  // froze the spinner whenever Railway flipped the row mid-build.
  const isDeploying = buildSnap?.status === "pending" || buildSnap?.status === "building";
  const isLive = buildSnap?.status === "ready";

  // Long-wait escalation for the deploy phase. We escalate copy at 60s/90s
  // and surface a friendly "deploy stalled" card at 150s so the user always
  // has a way to retry or keep working — never a stranded spinner.
  const [deployElapsed, setDeployElapsed] = useState(0);
  useEffect(() => {
    if (!isDeploying || !buildSnap) {
      setDeployElapsed(0);
      return;
    }
    const tick = () => setDeployElapsed(Math.floor((Date.now() - buildSnap.observedAt) / 1000));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [isDeploying, buildSnap?.observedAt]);

  // Once we cross the 150s threshold, surface the friendly stalled card.
  // The card lets the user Retry (re-trigger the build with the current
  // files) or Keep editing (dismiss; if Railway eventually responds the
  // status will still flip to ready in the background).
  useEffect(() => {
    if (!isDeploying || friendlyError) return;
    if (deployElapsed < 150) return;
    setFriendlyError({
      title: "Publishing is taking longer than usual",
      message:
        "Your code is ready — the publishing service hasn't reported back yet. You can retry the deploy or keep editing while we wait.",
      actionLabel: "Retry deploy",
      actionKind: "retry",
      technicalDetail: `Deploy elapsed ${deployElapsed}s with no callback`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployElapsed, isDeploying]);


  // Subscribe to `projects` row changes so when the build callback writes a
  // new `latest_build_id` (or any other field), the UI picks it up immediately
  // without waiting for a manual refetch. Without this, the activity card
  // can stay subscribed to a stale build id and miss the "ready" event.
  // Polling fallback covers iOS Safari where realtime websockets often die.
  useEffect(() => {
    const projectId = project?.id;
    if (!projectId) return;

    let cancelled = false;
    const refetch = async () => {
      const r = await getProject(projectId);
      if (cancelled || !r) return;
      setProject((prev) => {
        if (!prev) return r;
        // Only swap when something material changed to avoid render churn.
        if (
          prev.latest_build_id === r.latest_build_id &&
          prev.title === r.title
        ) {
          return prev;
        }
        return { ...prev, ...r };
      });
    };

    const channel = supabase
      .channel(`project:${projectId}:${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          if (cancelled) return;
          const next = payload.new as Partial<ProjectRow>;
          setProject((prev) => (prev ? { ...prev, ...next } : prev));
        },
      )
      .subscribe((status, err) => {
        if (err) console.warn("[Builder] project realtime unavailable", err);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") void refetch();
      });

    // Polling fallback (mobile/iOS where websockets are unreliable).
    const poll = window.setInterval(() => {
      void refetch();
    }, 10_000);

    // Catch-up when returning from a backgrounded tab (iOS suspends WS).
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [project?.id]);

  // Reflect Cloudflare build state into the phase timeline + friendly errors.
  // On failure: auto-trigger the fix loop (Phase 2) up to MAX_AUTO_FIX_ATTEMPTS
  // before surfacing the manual "Ask Petal to fix it" button.
  useEffect(() => {
    if (!buildSnap) return;
    const buildId = project?.latest_build_id ?? null;

    // New build id → reset the attempt counter so a brand-new failure gets
    // its own pair of auto-fix attempts.
    if (autoFixRef.current.buildId !== buildId) {
      autoFixRef.current = { buildId, attempts: 0 };
    }

    if (buildSnap.status === "ready") {
      setPhases((p) => completeThrough(p, "live"));
      // A successful build clears the auto-fix counter — next failure starts fresh.
      autoFixRef.current.attempts = 0;
      // Phase 3 — push-update toast. If the project has been published before
      // and this brand-new ready build is newer than the pinned published one,
      // nudge the user to push the update. We key off the build id via
      // `pushUpdateToastedBuildIdRef` so the toast only fires once per build.
      const publishedId = project?.published_build_id ?? null;
      if (
        buildId &&
        publishedId &&
        publishedId !== buildId &&
        pushUpdateToastedBuildIdRef.current !== buildId
      ) {
        pushUpdateToastedBuildIdRef.current = buildId;
        toast("Changes ready to publish", {
          description: "Push the latest preview live for your visitors.",
          action: {
            label: "Update",
            onClick: () => setPublishOpen(true),
          },
        });
      }
    } else if (buildSnap.status === "pending" || buildSnap.status === "building") {
      // Both states keep the activity card on the deploying phase. Without
      // the 'building' branch, the card would freeze the moment Railway
      // started processing the job.
      setPhases((p) => advanceTo(p, "deploying"));
    } else if (buildSnap.status === "failed") {
      setPhases((p) => markFailed(p, "deploying"));
      const used = autoFixRef.current.attempts;
      if (used < MAX_AUTO_FIX_ATTEMPTS && !busy) {
        // Auto-fix path: bump the counter, show a calm "fixing it" panel,
        // and fire the same prompt the manual button would.
        autoFixRef.current.attempts = used + 1;
        setFriendlyError(autoFixingBuild(used + 1));
        setActivityVisible(true);
        // Defer to next tick so React commits the state above before send()
        // resets `friendlyError` and starts a new run.
        const t = setTimeout(() => {
          askPetalToFixRef.current?.();
        }, 50);
        return () => clearTimeout(t);
      }
      // Manual fallback after we've burned both auto-attempts.
      setFriendlyError(friendlyBuildFailure(buildSnap.errorMessage));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildSnap?.status, buildSnap?.errorMessage, project?.latest_build_id, project?.published_build_id, busy]);

  // Auto-hide the success card a little after the app goes live so the chat
  // returns to a calm state. The card itself also self-collapses.
  useEffect(() => {
    if (!isLive || friendlyError) return;
    const t = setTimeout(() => setActivityVisible(false), 12000);
    return () => clearTimeout(t);
  }, [isLive, friendlyError]);

  // If a newer build flips to ready while the "Publishing is taking longer"
  // stall card is still on screen, clear it — the deploy did succeed, we were
  // just watching an older orphaned build row that never got its callback.
  useEffect(() => {
    if (!isLive) return;
    if (friendlyError?.title?.startsWith("Publishing is taking")) {
      setFriendlyError(null);
    }
  }, [isLive, friendlyError]);

  // Cancel any in-flight generation on unmount or when switching projects.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [searchId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Show a "new" dot on the Preview tab when files change while Chat is active.
  useEffect(() => {
    if (files.length === 0) return;
    if (isMobile && mobileTab === "chat") setPreviewHasUpdate(true);
  }, [files, isMobile, mobileTab]);

  // Bootstrap: load existing project, or create a new one if no id in URL.
  useEffect(() => {
    let cancelled = false;
    if (!isReady) return;
    if (!user) {
      navigate({ to: "/auth", search: { mode: "signin", redirect: window.location.pathname + window.location.search } });
      return;
    }
    setBootstrapping(true);
    (async () => {
      try {
        if (searchId) {
          const p = await getProject(searchId);
          if (!p) {
            toast.error("Project not found");
            navigate({ to: "/projects" });
            return;
          }
          // Load files + messages + any in-flight assistant draft in parallel.
          // The draft (if present) means a previous tab was streaming a reply
          // when the page reloaded — we rehydrate it into the streaming bubble
          // so the user doesn't think their message vanished.
          const [fs, ms, draft] = await Promise.all([
            loadProjectFiles(p.id),
            loadProjectMessages(p.id),
            loadMessageDraft(p.id),
          ]);
          if (cancelled) return;
          setProject(p);
          setFiles(fs);
          setMessages(ms);
          setActiveFile(fs.find((f) => f.path === "index.html")?.path ?? fs[0]?.path ?? null);
          if (draft) {
            // Show the partial reply as a normal (non-collapsed) assistant
            // message tagged so the user understands it was rescued from a
            // previous session. We don't try to re-attach to the live stream
            // — that's beyond what a refresh can promise — but the user gets
            // back the context they had on screen before reload.
            const rescuedNote =
              "\n\n_(This reply was being written when the page was refreshed. The build itself may still be running — check the activity card or send a follow-up.)_";
            const rescued: ChatMessage = {
              role: "assistant",
              content: (draft.partial_content || "Petal was writing a reply…") + rescuedNote,
              plan: draft.partial_plan || undefined,
              recap: draft.partial_recap || undefined,
            };
            setMessages((prev) => [...prev, rescued]);
            // Drop the draft now that we've surfaced it — a second refresh
            // shouldn't keep re-appending the same rescue card.
            void clearMessageDraft(p.id);
          }
          // Hydrate composer + queue + attachments from this tab's session.
          const composerDraft = readDraft<string>(builderDraftKeys.composer(p.id));
          if (composerDraft) setInput(composerDraft);
          const queueDraft = readDraft<QueuedMessage[]>(builderDraftKeys.queue(p.id));
          if (queueDraft && queueDraft.length > 0) setPendingQueue(queueDraft);
          const attachDraft = readDraft<ChatAttachment[]>(builderDraftKeys.attachments(p.id));
          if (attachDraft && attachDraft.length > 0) setPendingAttachments(attachDraft);
        } else {
          // No project id in the URL: don't create a row yet. We'll create one
          // lazily on the first send/discuss so empty "Untitled project" rows
          // never get persisted (and the slug reflects the real first prompt).
          if (cancelled) return;
          setProject(null);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not open project");
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, user, searchId]);

  // Look up whether this project already has a backend connected. Done once
  // per project; the chip only appears when this resolves to false.
  useEffect(() => {
    if (!project?.id) {
      setHasBackend(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await getProjectBackend(project.id);
        if (!cancelled) setHasBackend(!!result);
      } catch {
        if (!cancelled) setHasBackend(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  // Reset chip dismissals when switching projects.
  useEffect(() => {
    setDismissedBackendChips(new Set());
  }, [project?.id]);

  // Mirror the composer text, queued messages, and pending attachments to
  // sessionStorage so a browser refresh inside /builder doesn't wipe them.
  // Per-project, per-tab. Cleared automatically when the values empty out.
  useEffect(() => {
    if (!project) return;
    const key = builderDraftKeys.composer(project.id);
    if (input.trim()) writeDraft(key, input);
    else clearDraft(key);
  }, [project, input]);

  useEffect(() => {
    if (!project) return;
    const key = builderDraftKeys.queue(project.id);
    if (pendingQueue.length > 0) writeDraft(key, pendingQueue);
    else clearDraft(key);
  }, [project, pendingQueue]);

  useEffect(() => {
    if (!project) return;
    const key = builderDraftKeys.attachments(project.id);
    if (pendingAttachments.length > 0) writeDraft(key, pendingAttachments);
    else clearDraft(key);
  }, [project, pendingAttachments]);


  // Auto-send the prompt from the landing page once, after bootstrap.
  // Note: project may be null here when arriving with ?prompt but no ?id —
  // send() will lazily create the project on first use.
  useEffect(() => {
    if (
      !bootstrapping &&
      initialPrompt &&
      !initialSent.current &&
      messages.length === 0
    ) {
      initialSent.current = true;
      if (initialMode === "discuss") void discuss(initialPrompt);
      else void send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapping, initialPrompt]);

  // Lazily create the underlying project row on first use, so /builder visits
  // that never send a message don't leave behind empty "Untitled project" rows.
  const ensureProject = useCallback(async (): Promise<ProjectRow | null> => {
    if (!isReady || !user) {
      navigate({ to: "/auth", search: { mode: "signin", redirect: window.location.pathname + window.location.search } });
      return null;
    }
    if (project) return project;
    try {
      const p = await createProject();
      setProject(p);
      navigate({
        to: "/builder",
        search: { id: p.id, prompt: initialPrompt, mode: initialMode, attachKey: undefined },
        replace: true,
      });
      return p;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start project");
      return null;
    }
  }, [isReady, user, project, navigate, initialPrompt]);

  const send = useCallback(
    async (
      content: string,
      opts: { isRetry?: boolean; attachments?: ChatAttachment[]; forceBuild?: boolean } = {},
    ) => {
      const text = content.trim();
      if (!text || busy) return;
      const proj = await ensureProject();
      if (!proj) return;
      setError(null);
      setFriendlyError(null);
      // Attachments precedence: explicit opts > composer state > stashed initial.
      const attachments =
        opts.attachments ??
        (pendingAttachments.length > 0
          ? pendingAttachments
          : initialAttachmentsRef.current.length > 0
            ? initialAttachmentsRef.current
            : undefined);
      const userMsg: ChatMessage = {
        role: "user",
        content: text,
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                mimeType: a.mimeType,
                dataUrl: a.dataUrl,
                name: a.name,
              })),
            }
          : {}),
      };
      // On retry, the failing user message is already in `messages` — don't double-append.
      const nextMessages: ChatMessage[] = opts.isRetry ? messages : [...messages, userMsg];
      if (!opts.isRetry) setMessages(nextMessages);
      setLastUserPrompt(text);
      setInput("");
      setPendingAttachments([]);
      initialAttachmentsRef.current = [];
      setBusy(true);

      // Persist the user message to the DB *before* the stream starts. If the
      // user refreshes mid-build (which can take 30–60s) we still want to show
      // them what they just asked Petal — losing the prompt entirely is the
      // single most disorienting failure mode here. The assistant reply is
      // persisted later, after a successful stream.
      if (!opts.isRetry) {
        try {
          await appendMessages(proj.id, [userMsg]);
        } catch (persistErr) {
          // Non-fatal: the message still lives in local state for this session.
          console.warn("Could not persist user message early:", persistErr);
        }
      }

      // Fresh activity feed for this run — but DO NOT mount it yet. We mount
      // the build phase card only after triage classifies this as a "build"
      // turn, so a casual "hi" never triggers the deploy pipeline UI.
      setPhases(defaultPhases());
      setDesignCaption("");
      setFilesWritten(0);
      setLatestPath(undefined);
      setWrittenPaths([]);
      setFinalFileLines({});
      setFileChanges({});
      setStreamingAssistant("");
      setStreamingPlan("");
      setStreamingRecap("");
      setStreamingPreamble("");
      setIntentBuild(false);
      setActivityVisible(false);

      let resultFiles: ProjectFile[] | null = null;
      let resultSummary = "";
      let resultPlan: string | undefined;
      let resultRecap: string | undefined;
      // Layer 5 — populated by onSelfCheck so we can attach gap-driven
      // follow-up chips to the assistant message and on error suggestions.
      let resultSuggestions: string[] = [];
      let resultVerdict: string | undefined;
      let streamError: string | null = null;
      let errorSuggestions: string[] = [];
      // Mirror of the streamingAssistant state we accumulate as deltas come in.
      // Kept locally so the catch/finally branches can read the latest value
      // synchronously without going through React state.
      let partialAssistant = "";
      let partialPlan = "";
      let partialRecap = "";
      let partialPreamble = "";

      // Persist Petal's in-flight reply to the DB at most every ~600ms so a
      // browser refresh during the build rehydrates the streaming bubble
      // instead of leaving the user staring at their own prompt.
      const draftWriter = createDraftWriter(proj.id);

      // Cancel any prior in-flight request before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // ── Step 1: triage ────────────────────────────────────────────────
        // Classify the user's message as chat | clarify | build and stream
        // a warm preamble while we decide. This is what makes Petal feel
        // human instead of jumping straight into the build pipeline for
        // every message — including conversational ones like "hi" or "thanks".
        //
        // forceBuild short-circuits triage entirely. Used by one-click
        // follow-up chips from the self-check (Layer 5): the user already
        // committed to the action by tapping it, so re-classifying as
        // "clarify" or "chat" would feel broken.
        if (!opts.forceBuild) {
          const triage = await streamTriage(
            {
              messages: nextMessages,
              currentFiles: files,
              customInstructions: proj.custom_instructions ?? undefined,
              projectId: proj.id,
            },
            {
              onReplyDelta: (d) => {
                partialPreamble += d;
                setStreamingPreamble((s) => s + d);
              },
            },
            controller.signal,
          );

          if (controller.signal.aborted) return;

          // ── Step 2a: chat / clarify — no build, just promote the warm
          //            reply (plus any clickable suggestion chips) into a
          //            real assistant message and stop here.
          if (triage.intent !== "build") {
            const replyText = (triage.reply || partialPreamble).trim();
            const suggestions = triage.meta?.suggestions ?? [];
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content:
                replyText.length > 0
                  ? replyText
                  : "Hi! What would you like to build?",
              ...(suggestions.length > 0 ? { suggestions } : {}),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreamingPreamble("");
            setLastUserPrompt(null);
            try {
              await appendMessages(proj.id, [assistantMsg]);
            } catch (persistErr) {
              console.warn("Could not persist assistant chat reply:", persistErr);
            }
            return;
          }
        } else {
          // Forced build — clear any preamble state we'd normally fill from triage.
          setStreamingPreamble("");
        }

        // ── Step 2b: build — show the activity card now and continue. ────
        setIntentBuild(true);
        setActivityVisible(true);

        await streamGenerate(
          {
            messages: nextMessages,
            currentFiles: files,
            model: "smart",
            customInstructions: proj.custom_instructions ?? undefined,
            projectId: proj.id,
          },
          {
            onPhase: (phase: PhaseId) => {
              setPhases((p) => advanceTo(p, phase));
            },
            onPlanDelta: (d) => {
              partialPlan += d;
              setStreamingPlan((s) => s + d);
              draftWriter.queue({ content: partialAssistant, plan: partialPlan, recap: partialRecap });
            },
            onSummaryDelta: (d) => {
              // Two consumers of the same stream:
              //   - structured timeline (designCaption under "Designing")
              //   - live assistant bubble in the chat thread
              partialAssistant += d;
              setDesignCaption((s) => s + d);
              setStreamingAssistant((s) => s + d);
              draftWriter.queue({ content: partialAssistant, plan: partialPlan, recap: partialRecap });
            },
            onRecapDelta: (d) => {
              partialRecap += d;
              setStreamingRecap((s) => s + d);
              draftWriter.queue({ content: partialAssistant, plan: partialPlan, recap: partialRecap });
            },
            onFileProgress: (n, path) => {
              setFilesWritten(n);
              if (path) {
                setLatestPath(path);
                // Append to ordered, deduped list so the user sees each file
                // appear in the activity card as Petal writes it.
                setWrittenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
              }
            },
            onResult: (f, s, extras) => {
              resultFiles = f;
              resultSummary = s;
              resultPlan = extras?.plan;
              resultRecap = extras?.recap;
              if (typeof extras?.creditsCharged === "number") {
                setLastBuildCredits(extras.creditsCharged);
              }
            },
            onSelfCheck: (v) => {
              // Layer 5 — surface honest follow-ups as suggestion chips.
              // Only carry forward suggestions when the model thinks the
              // build genuinely missed something (score < 90 or non-empty
              // gaps); a clean build shouldn't nag.
              if (v.suggestions.length > 0 && (v.score < 90 || v.gaps.length > 0)) {
                resultSuggestions = v.suggestions;
              }
              resultVerdict = v.verdict;
            },
            onError: (m, sugg) => {
              streamError = m;
              if (sugg && sugg.length > 0) errorSuggestions = sugg;
            },
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;
        if (streamError) throw new Error(streamError);
        if (!resultFiles) throw new Error("No result returned.");

        const files2: ProjectFile[] = resultFiles;
        const summary2: string = resultSummary || "Updated the project.";
        // Persist the warm preamble alongside the technical summary so the
        // chat thread retains the human voice on refresh — without it, all
        // we'd see in history is the dryer "Updated the project." line.
        const preambleText = partialPreamble.trim();
        const combinedContent = preambleText
          ? `${preambleText}\n\n${summary2}`
          : summary2;
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: combinedContent,
          plan: resultPlan,
          recap: resultRecap,
          // Layer 5 — gap-driven follow-up chips. Empty array stays out of
          // the message so a clean build doesn't render an empty chip row.
          ...(resultSuggestions.length > 0 ? { suggestions: resultSuggestions } : {}),
        };
        setFiles(files2);
        setActiveFile((prev) => prev ?? "index.html");
        setMessages((prev) => [...prev, assistantMsg]);
        setPreviewKey((k) => k + 1);
        setLastUserPrompt(null);
        // The streaming bubble has been promoted into a real message — clear it.
        setStreamingAssistant("");
        setStreamingPlan("");
        setStreamingRecap("");
        setStreamingPreamble("");

        // Compute final per-file line counts for the activity card. We only
        // surface counts for files Petal actually wrote in this run, so the
        // list matches what the user just saw stream in.
        setFinalFileLines(() => {
          const map: Record<string, number> = {};
          for (const f of files2) {
            map[f.path] = f.content.split("\n").length;
          }
          return map;
        });

        // Diff against the pre-run snapshot. `files` (closure-captured at
        // function entry) is the "before" state — `files2` is the "after".
        // We surface added / modified / deleted with line +/- so users see
        // exactly what Petal touched, not just total file sizes.
        const beforeMap = new Map(files.map((f) => [f.path, f.content]));
        const afterMap = new Map(files2.map((f) => [f.path, f.content]));
        const changes: Record<
          string,
          { kind: "added" | "modified" | "unchanged" | "deleted"; addedLines: number; removedLines: number }
        > = {};
        for (const f of files2) {
          const before = beforeMap.get(f.path);
          const afterLines = f.content.split("\n").length;
          if (before === undefined) {
            changes[f.path] = { kind: "added", addedLines: afterLines, removedLines: 0 };
          } else if (before === f.content) {
            changes[f.path] = { kind: "unchanged", addedLines: 0, removedLines: 0 };
          } else {
            const beforeLines = before.split("\n").length;
            // We deliberately don't ship a real LCS diff — the bundle cost
            // isn't worth it for an inline activity badge. Instead we report
            // the line-count delta. A modified file with the same line count
            // shows "~ modified" with no number, which is more honest than
            // a fake +N/-N from a heuristic.
            const delta = afterLines - beforeLines;
            changes[f.path] = {
              kind: "modified",
              addedLines: Math.max(delta, 0),
              removedLines: Math.max(-delta, 0),
            };
          }
        }
        // Surface deletions too: anything that was in `before` but not in `after`.
        const deletedPaths: string[] = [];
        for (const f of files) {
          if (!afterMap.has(f.path)) {
            const removedLines = f.content.split("\n").length;
            changes[f.path] = { kind: "deleted", addedLines: 0, removedLines };
            deletedPaths.push(f.path);
          }
        }
        setFileChanges(changes);
        // Make deleted paths visible in the writing-phase file list too,
        // otherwise the user has no way to know a file is gone.
        if (deletedPaths.length > 0) {
          setWrittenPaths((prev) => {
            const set = new Set(prev);
            const next = [...prev];
            for (const p of deletedPaths) {
              if (!set.has(p)) next.push(p);
            }
            return next;
          });
        }

        // AI work is fully done — mark polishing complete and move to deploying.
        setPhases((p) => completeThrough(p, "polishing"));
        setPhases((p) => advanceTo(p, "deploying"));

        try {
          // The user message was already persisted up-front (see send() entry)
          // so we only need to write the assistant reply now.
          const persistMsgs: ChatMessage[] = [assistantMsg];
          await Promise.all([
            saveProjectFiles(proj.id, files2),
            appendMessages(proj.id, persistMsgs),
            maybeAutoTitleProject(proj, summary2, text),
            createVersion(proj.id, files2, {
              origin: "auto",
              label: text.slice(0, 60),
              summary: summary2,
            }),
          ]);
          setHistoryKey((k) => k + 1);
          const refreshed = await getProject(proj.id);
          if (refreshed) setProject(refreshed);

          // Kick off a Cloudflare Pages build. Fire-and-forget — the activity
          // card subscribes to project_builds via useBuildActivity().
          void triggerBuild(proj.id)
            .then(async () => {
              const r = await getProject(proj.id);
              if (r) setProject(r);
            })
            .catch((err: unknown) => {
              setFriendlyError(toFriendlyError(err));
              setPhases((p) => markFailed(p, "deploying"));
            });
        } catch (persistErr) {
          console.error(persistErr);
          toast.error("Generated, but couldn't save changes.");
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        setError(msg);
        setFriendlyError(toFriendlyError(e));
        setPhases((p) => markFailed(p));

        // Preserve whatever Petal had said before failing. Without this, the
        // streaming bubble disappears in the `finally` below and the user is
        // left staring at their own prompt with no context — they don't know
        // whether Petal even started thinking. We persist it locally only;
        // it's not written to the DB because the run failed and `lastUserPrompt`
        // remains set so the retry replays the same user message cleanly.
        const preambleTrim = partialPreamble.trim();
        const trimmed = partialAssistant.trim();
        const rescued = [preambleTrim, trimmed].filter(Boolean).join("\n\n");
        // If Petal had partial output OR Layer 5 produced retry suggestions,
        // append a single message that carries both — the chips piggyback on
        // the existing assistant-suggestions render path (line ~1741).
        if (rescued.length > 0 || errorSuggestions.length > 0) {
          const fallbackContent = rescued.length > 0 ? rescued : msg;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: fallbackContent,
              ...(errorSuggestions.length > 0 ? { suggestions: errorSuggestions } : {}),
            },
          ]);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        // Drop any partial streaming text — either it became a real message
        // above, or the run failed/aborted and we don't want a stale bubble.
        setStreamingAssistant("");
        setStreamingPlan("");
        setStreamingRecap("");
        setStreamingPreamble("");
        // Tear down the streaming-draft writer and wipe the row so the next
        // refresh doesn't resurrect a reply that's already been promoted into
        // the chat thread (or that failed and shouldn't reappear).
        draftWriter.cancel();
        void clearMessageDraft(proj.id);
      }
    },
    [busy, messages, files, ensureProject, pendingAttachments],
  );

  // Discuss mode: ask Petal a question without touching files. The reply is
  // appended as a normal assistant message and tagged so we can show an
  // "Apply this plan" button under it.
  const discuss = useCallback(
    async (content: string, opts: { attachments?: ChatAttachment[] } = {}) => {
      const text = content.trim();
      if (!text || busy || discussBusy) return;
      const proj = await ensureProject();
      if (!proj) return;
      setError(null);
      setFriendlyError(null);
      const attachments =
        opts.attachments ??
        (pendingAttachments.length > 0
          ? pendingAttachments
          : initialAttachmentsRef.current.length > 0
            ? initialAttachmentsRef.current
            : undefined);
      const userMsg: ChatMessage = {
        role: "user",
        content: text,
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                mimeType: a.mimeType,
                dataUrl: a.dataUrl,
                name: a.name,
              })),
            }
          : {}),
      };
      const nextMessages: ChatMessage[] = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      setPendingAttachments([]);
      initialAttachmentsRef.current = [];
      setDiscussBusy(true);

      // Persist the user prompt up-front so a refresh during the request
      // doesn't lose what they asked. We'll write the assistant reply (and,
      // on failure, roll the prompt back out of the DB) below.
      let userMsgPersisted = false;
      try {
        await appendMessages(proj.id, [userMsg]);
        userMsgPersisted = true;
      } catch (persistErr) {
        console.warn("Could not persist discuss prompt early:", persistErr);
      }

      try {
        const reply = await requestDiscussion({
          messages: nextMessages,
          currentFiles: files,
          customInstructions: proj.custom_instructions ?? undefined,
        });
        const assistantMsg: ChatMessage = { role: "assistant", content: reply };
        setMessages((prev) => {
          const updated = [...prev, assistantMsg];
          setLastDiscussIndex(updated.length - 1);
          return updated;
        });
        // User message already saved above — only write the assistant reply.
        try {
          await appendMessages(proj.id, [assistantMsg]);
        } catch (persistErr) {
          console.error(persistErr);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Discussion failed.";
        toast.error(msg);
        // Roll back the unanswered user message so the chat doesn't look stuck.
        setMessages((prev) => prev.slice(0, -1));
        // Also drop the prompt from the DB so the next reload doesn't
        // resurrect a question Petal never answered.
        if (userMsgPersisted) {
          try {
            await truncateMessagesToCount(proj.id, messages.length);
          } catch (truncErr) {
            console.warn("Could not roll back discuss prompt:", truncErr);
          }
        }
      } finally {
        setDiscussBusy(false);
      }
    },
    [busy, discussBusy, project, messages, files, ensureProject, pendingAttachments],
  );

  // Apply the most recent Discuss reply by switching to Build mode and asking
  // Petal to implement what it just proposed.
  const applyDiscussedPlan = useCallback(() => {
    if (lastDiscussIndex == null) return;
    const plan = messages[lastDiscussIndex]?.content?.trim();
    if (!plan) return;
    setMode("build");
    setLastDiscussIndex(null);
    void send(
      `Please implement the plan you just proposed:\n\n${plan}\n\nMake the changes now.`,
    );
  }, [lastDiscussIndex, messages, send]);

  // Either dispatch the prompt now (if Petal is free) or queue it. The queue
  // remembers the mode the user picked when they typed it, so a discuss-mode
  // queued message stays a discussion even if mode changes later.
  const submitPrompt = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || bootstrapping) return;
      if (busy || discussBusy) {
        setPendingQueue((q) => [
          ...q,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: trimmed, mode },
        ]);
        setInput("");
        return;
      }
      if (mode === "discuss") void discuss(trimmed);
      else void send(trimmed);
    },
    [bootstrapping, busy, discussBusy, mode, discuss, send],
  );

  // Auto-dequeue the next prompt as soon as Petal frees up.
  useEffect(() => {
    if (busy || discussBusy) return;
    if (pendingQueue.length === 0) return;
    const [next, ...rest] = pendingQueue;
    setPendingQueue(rest);
    if (next.mode === "discuss") void discuss(next.text);
    else void send(next.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, discussBusy, pendingQueue]);

  const removeFromQueue = useCallback((id: string) => {
    setPendingQueue((q) => q.filter((m) => m.id !== id));
  }, []);

  const moveInQueue = useCallback((id: string, direction: -1 | 1) => {
    setPendingQueue((q) => {
      const i = q.findIndex((m) => m.id === id);
      if (i === -1) return q;
      const j = i + direction;
      if (j < 0 || j >= q.length) return q;
      const next = q.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const reorderQueueByDrag = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setPendingQueue((q) => {
      const from = q.findIndex((m) => m.id === fromId);
      const to = q.findIndex((m) => m.id === toId);
      if (from === -1 || to === -1) return q;
      const next = q.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // Per-message revert: restore the project to the snapshot taken right after
  // the AI replied to the Nth user message, then trim chat history accordingly.
  // We rely on the invariant that send() creates one auto-version per turn,
  // labelled with the user's prompt. We match by ordinal.
  // Step 1: look up the target snapshot and open the diff-preview dialog.
  const prepareRevertToMessage = useCallback(
    async (userMsgIndex: number) => {
      if (!project) return;
      const userMsg = messages[userMsgIndex];
      if (!userMsg || userMsg.role !== "user") return;
      const userOrdinal = messages
        .slice(0, userMsgIndex + 1)
        .filter((m) => m.role === "user").length;
      setRevertPreparing(userMsgIndex);
      try {
        const versions = await listVersions(project.id);
        const autoVersionsOldestFirst = versions
          .filter((v) => v.origin === "auto" && v.label !== "Before restore" && v.label !== "Before revert")
          .reverse();
        const target = autoVersionsOldestFirst[userOrdinal - 1];
        if (!target) {
          toast.error("Couldn't find a snapshot for that message.");
          return;
        }
        setRevertPreview({
          userMsgIndex,
          userOrdinal,
          targetFiles: target.files,
          label: userMsg.content.replace(/\s+/g, " ").trim().slice(0, 80),
        });
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "Couldn't load snapshot");
      } finally {
        setRevertPreparing(null);
      }
    },
    [project, messages],
  );

  // Step 2: actually perform the revert after the user confirms.
  const commitRevertToMessage = useCallback(async () => {
    if (!project || !revertPreview) return;
    const { userMsgIndex, userOrdinal, targetFiles } = revertPreview;
    setRevertingIndex(userMsgIndex);
    try {
      if (files.length) {
        await createVersion(project.id, files, {
          origin: "auto",
          label: "Before revert",
        });
      }
      await saveProjectFiles(project.id, targetFiles);
      const keep = userOrdinal * 2;
      await truncateMessagesToCount(project.id, keep);
      setFiles(targetFiles);
      setMessages((prev) => prev.slice(0, keep));
      setLastDiscussIndex(null);
      setPreviewKey((k) => k + 1);
      setHistoryKey((k) => k + 1);
      setRevertPreview(null);
      toast.success("Reverted");
      void triggerBuild(project.id)
        .then(async () => {
          const r = await getProject(project.id);
          if (r) setProject(r);
        })
        .catch((err: unknown) => console.error("triggerBuild failed", err));
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Couldn't revert");
    } finally {
      setRevertingIndex(null);
    }
  }, [project, revertPreview, files]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setActivityVisible(false);
  }, []);

  const retry = useCallback(() => {
    if (lastUserPrompt) void send(lastUserPrompt, { isRetry: true });
  }, [lastUserPrompt, send]);

  /** Re-trigger a Cloudflare build for the current files. Used by the
   *  "deploy stalled" friendly card so the user can recover from a silent
   *  Railway hiccup without having to re-prompt the AI. */
  const retryDeploy = useCallback(() => {
    if (!project?.id) return;
    setFriendlyError(null);
    setPhases((p) => advanceTo(p, "deploying"));
    setActivityVisible(true);
    void triggerBuild(project.id)
      .then(async () => {
        const r = await getProject(project.id);
        if (r) setProject(r);
      })
      .catch((err: unknown) => {
        setFriendlyError(toFriendlyError(err));
        setPhases((p) => markFailed(p, "deploying"));
      });
  }, [project?.id]);

  const askPetalToFix = useCallback(() => {
    setFriendlyError(null);
    // Feed the actual build error/log back into the next prompt so the AI
    // can patch the real cause (this is what Lovable, Bolt and Base44 do).
    // The Railway callback already concatenates logs into error_message.
    const rawLog = buildSnap?.errorMessage?.trim();
    const tail = rawLog
      ? rawLog.split("\n").slice(-60).join("\n").slice(-3500)
      : "";
    // When this is an auto-fix retry (Phase 2), nudge the AI to try a
    // different angle than its previous attempt.
    const attempt = autoFixRef.current.attempts;
    const retryNote =
      attempt > 1
        ? "\n\nNote: this is your second attempt at fixing the same build. Your previous fix did not resolve the issue — re-read the error carefully and try a different approach."
        : "";
    const prompt = tail
      ? [
          "The build just failed with this error from the bundler:",
          "",
          "```",
          tail,
          "```",
          "",
          "Please look at the relevant files in the project, identify the root cause, and fix it. Make the smallest change that will let the build succeed.",
        ].join("\n") + retryNote
      : "The build failed but no error log was captured. Please review the project files for obvious mistakes (missing imports, syntax errors, typos in package.json) and fix them." +
        retryNote;
    void send(prompt, { isRetry: false });
  }, [send, buildSnap]);

  // Keep the ref in sync so the build-failure effect (declared earlier in
  // the component) can call into the latest closure.
  useEffect(() => {
    askPetalToFixRef.current = askPetalToFix;
  }, [askPetalToFix]);

  async function downloadProject() {
    if (!files.length) return;
    // Lazy-load jszip — keeps ~100KB out of the initial /builder bundle.
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.content);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.slug ?? "petal-project"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(restored: ProjectFile[]) {
    if (!project) return;
    await saveProjectFiles(project.id, restored);
    setFiles(restored);
    setActiveFile(
      (prev) =>
        restored.find((f) => f.path === prev)?.path ??
        restored.find((f) => f.path === "index.html")?.path ??
        restored[0]?.path ??
        null,
    );
    setPreviewKey((k) => k + 1);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "↩️ Restored a previous version." },
    ]);
    await appendMessages(project.id, [
      { role: "assistant", content: "↩️ Restored a previous version." },
    ]);
    setHistoryKey((k) => k + 1);
    void triggerBuild(project.id)
      .then(async () => {
        const r = await getProject(project.id);
        if (r) setProject(r);
      })
      .catch((err: unknown) => console.error("triggerBuild failed", err));
  }

  const activeContent = files.find((f) => f.path === activeFile)?.content ?? "";

  // ⌘K / Ctrl+K to open command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [
      {
        id: "view-preview",
        label: "Show preview",
        group: "View",
        icon: <Eye className="h-3.5 w-3.5" />,
        onSelect: () => setView("preview"),
      },
      {
        id: "view-code",
        label: "Show code",
        group: "View",
        icon: <Code2 className="h-3.5 w-3.5" />,
        onSelect: () => setView("code"),
      },
      {
        id: "reload",
        label: "Reload preview",
        group: "Actions",
        icon: <RotateCw className="h-3.5 w-3.5" />,
        onSelect: () => setPreviewKey((k) => k + 1),
      },
    ];
    if (lastUserPrompt) {
      items.push({
        id: "regenerate",
        label: "Regenerate last prompt",
        hint: lastUserPrompt.slice(0, 40),
        group: "Actions",
        icon: <RefreshCcw className="h-3.5 w-3.5" />,
        onSelect: () => void send(lastUserPrompt, { isRetry: true }),
      });
    }
    for (const f of files) {
      items.push({
        id: `file-${f.path}`,
        label: f.path,
        group: "Files",
        icon: <FileCode2 className="h-3.5 w-3.5" />,
        onSelect: () => {
          setView("code");
          setActiveFile(f.path);
        },
      });
    }
    return items;
  }, [files, lastUserPrompt, send]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* First-run product tour. Self-gates on localStorage so it shows once per browser. */}
      <Suspense fallback={null}>
        <FirstRunTour />
      </Suspense>
      {/* Top bar */}
      <header className="safe-top sticky top-0 z-30 grid h-14 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border bg-card/80 px-3 backdrop-blur sm:px-4">
        {/* Left: hamburger (mobile) + back/title (desktop) */}
        <div className="flex min-w-0 items-center gap-2">
          {/* Mobile: hamburger opens the projects drawer */}
          <button
            type="button"
            onClick={() => setProjectsDrawerOpen(true)}
            aria-label="Open projects menu"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-foreground transition hover:bg-muted md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Desktop: hamburger + back to projects */}
          <button
            type="button"
            onClick={() => setProjectsDrawerOpen(true)}
            aria-label="Open projects menu"
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-foreground transition hover:bg-muted md:grid"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            to="/projects"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted md:inline-flex"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Projects</span>
          </Link>
          <div className="hidden h-5 w-px bg-border md:block" />
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-display text-base" title={project?.title ?? undefined}>
                {project?.title ?? (bootstrapping ? "Loading…" : "New project")}
              </span>
              {project?.summary && (
                <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                  {project.summary}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Center: project name (mobile only). Tap to open the actions sheet. */}
        <button
          type="button"
          onClick={() => setActionsOpen(true)}
          className="mx-auto inline-flex max-w-[60vw] items-center gap-1 rounded-lg px-2 py-1 text-foreground transition hover:bg-muted md:hidden"
          aria-label="Project menu"
        >
          <span className="truncate font-display text-base font-semibold">
            {project?.title ?? (bootstrapping ? "Loading…" : "New project")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        {/* Spacer on desktop so the right column hugs the edge. */}
        <div className="hidden md:block" />

        {/* Right: view toggle + desktop toolbar */}
        <div className="flex shrink-0 items-center gap-2 justify-self-end">
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-sm">
            <button
              onClick={() => setView("preview")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition sm:px-3 ${
                view === "preview" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Preview</span>
            </button>
            <button
              onClick={() => setView("code")}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition sm:px-3 ${
                view === "code" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Code</span>
            </button>
          </div>
          {/* Desktop toolbar */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-1.5 rounded-lg border border-border px-2 text-xs text-muted-foreground transition hover:bg-muted md:inline-flex"
            title="Command palette (⌘K)"
          >
            <CommandIcon className="h-3.5 w-3.5" />
            <span className="font-mono">⌘K</span>
          </button>
          <button
            onClick={() => setPreviewKey((k) => k + 1)}
            disabled={!files.length}
            className="hidden h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted disabled:opacity-40 md:grid"
            title="Reload preview"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          {project && (
            <div className="hidden md:block">
              <HistoryPanel
                projectId={project.id}
                currentFiles={files}
                onRestore={handleRestore}
                refreshKey={historyKey}
              />
            </div>
          )}
          {project && (
            <button
              type="button"
              onClick={() => setShieldOpen(true)}
              className="hidden h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted md:grid"
              title="Petal Shield — security audit"
              aria-label="Open Petal Shield"
            >
              <Shield className="h-4 w-4" />
            </button>
          )}
          {project && <ReadinessBadge files={files} project={project} />}
          {project && (
            <div className="hidden md:block">
              <SharePopover
                project={project}
                onChange={setProject}
                onConnectDomain={() => {
                  setSettingsScrollTo("domains");
                  setSettingsOpen(true);
                }}
                onUpgrade={() => setBillingOpen(true)}
              />
            </div>
          )}
          {project && (
            <button
              type="button"
              onClick={() => setPublishOpen(true)}
              className="hidden h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 md:inline-flex"
              title="Publish"
            >
              <Globe className="h-3.5 w-3.5" />
              {buildSnap?.status === "pending"
                ? "Publishing…"
                : buildSnap?.status === "failed"
                  ? "Retry publish"
                  : project.latest_build_id && buildSnap?.status === "ready"
                    ? "Published"
                    : "Publish"}
            </button>
          )}
          {project && (
            <ProjectSettingsSheet
              project={project}
              onChange={setProject}
              open={settingsOpen}
              onOpenChange={(o) => {
                setSettingsOpen(o);
                if (!o) setSettingsScrollTo(null);
              }}
              scrollTo={settingsScrollTo}
              onScrollHandled={() => setSettingsScrollTo(null)}
            />
          )}
          <button
            onClick={downloadProject}
            disabled={!files.length}
            className="hidden h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-40 md:inline-flex"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </header>

      <RuntimeLowBalanceBanner projectId={project?.id ?? null} />

      {/* Mobile builder menu + dependent dialogs */}
      {project && (
        <>
          <BuilderActionsSheet
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenRename={() => setRenameOpen(true)}
            onOpenBilling={() => setBillingOpen(true)}
            onOpenPublish={() => setPublishOpen(true)}
          />
          <RenameProjectDialog
            project={project}
            open={renameOpen}
            onOpenChange={setRenameOpen}
            onChange={setProject}
          />
          <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
          <PetalShieldSheet
            open={shieldOpen}
            onOpenChange={setShieldOpen}
            files={files}
            onSendFixPrompt={(p) => setInput(p)}
          />
          <ProjectsDrawer
            open={projectsDrawerOpen}
            onOpenChange={setProjectsDrawerOpen}
            currentProjectId={project?.id ?? null}
          />
          <PublishSheet
            open={publishOpen}
            onOpenChange={setPublishOpen}
            project={project}
            onChange={setProject}
            onManageDomains={() => {
              setSettingsScrollTo("domains");
              setSettingsOpen(true);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </>
      )}


      {/* Mobile-only tab bar (Chat | Preview). Desktop uses the grid below. */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 flex shrink-0 items-center gap-1 border-b border-border bg-card/80 px-3 py-1.5 backdrop-blur md:hidden">
        <button
          onClick={() => setMobileTab("chat")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            mobileTab === "chat"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => {
            setMobileTab("preview");
            setPreviewHasUpdate(false);
          }}
          className={`relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            mobileTab === "preview"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Preview
          {previewHasUpdate && mobileTab !== "preview" && (
            <span
              aria-hidden
              className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-primary"
            />
          )}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_1fr]">
        {/* Chat */}
        <aside
          className={`flex min-h-0 flex-col border-b border-border bg-sidebar md:flex md:border-b-0 md:border-r ${
            mobileTab === "chat" ? "flex" : "hidden"
          }`}
        >
          <div className="border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Conversation
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
            {bootstrapping && (
              <div className="inline-flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading project…
              </div>
            )}
            {!bootstrapping && messages.length === 0 && !busy && (
              <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
                Describe an app to start. Try "a calm pomodoro timer with stats" or "a recipe card
                generator".
              </div>
            )}
            {messages.map((m, i) => {
              const isUser = m.role === "user";
              // Only allow revert if Petal already replied to this user
              // message (so a snapshot exists) and we're not mid-generation.
              const hasReply = isUser && messages[i + 1]?.role === "assistant";
              const canRevert = hasReply && !busy && !discussBusy;
              return (
                <div key={i} className="group min-w-0">
                  <div
                    className={`relative min-w-0 overflow-hidden wrap-anywhere rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed text-foreground ${
                      isUser ? "ml-3 bg-card sm:ml-6" : "mr-3 bg-secondary sm:mr-6"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>{isUser ? "you" : "petal"}</span>
                      {m.role === "assistant" && i === lastDiscussIndex && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-foreground/70">
                          <MessageSquare className="h-2.5 w-2.5" /> discuss
                        </span>
                      )}
                    </div>
                    {m.role === "assistant" ? (
                      <div className="space-y-2.5">
                        {m.plan && (() => {
                          const safePlan = sanitizeNarrative(m.plan);
                          return (
                            <CollapsibleSegment
                              label="Plan"
                              tone="primary"
                              icon={<Wand2 className="h-2.5 w-2.5" />}
                              defaultOpen={false}
                            >
                              <Suspense
                                fallback={<div className="whitespace-pre-wrap text-[13px]">{safePlan}</div>}
                              >
                                <MarkdownMessage content={safePlan} />
                              </Suspense>
                            </CollapsibleSegment>
                          );
                        })()}
                        <Suspense fallback={<div className="whitespace-pre-wrap">{sanitizeNarrative(m.content)}</div>}>
                          <MarkdownMessage content={sanitizeNarrative(m.content)} />
                        </Suspense>
                        {/* Quick-reply chips. Tapping a chip sends its label
                            as the next user turn — same as if they'd typed it.
                            Only the most recent assistant message shows them
                            so old chips don't pile up in the thread. */}
                        {m.suggestions && m.suggestions.length > 0 && i === messages.length - 1 && !busy && !discussBusy && (
                          <div className="-mx-0.5 mt-1 flex flex-wrap gap-1.5">
                            {m.suggestions.map((s, si) => (
                              <button
                                key={si}
                                type="button"
                                // One-click follow-up: skip triage and go
                                // straight into a build turn. The user
                                // already decided by tapping the chip; a
                                // re-classification round-trip here would
                                // feel broken (and sometimes mis-routes
                                // short edits as "clarify").
                                onClick={() => void send(s, { forceBuild: true })}
                                className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground shadow-sm transition hover:bg-accent hover:text-accent-foreground"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                        {m.recap && (() => {
                          const safeRecap = sanitizeNarrative(m.recap);
                          return (
                            <CollapsibleSegment
                              label="What changed"
                              tone="muted"
                              icon={<FileText className="h-2.5 w-2.5" />}
                              defaultOpen={false}
                            >
                              <Suspense
                                fallback={<div className="whitespace-pre-wrap text-[13px]">{safeRecap}</div>}
                              >
                                <MarkdownMessage content={safeRecap} />
                              </Suspense>
                            </CollapsibleSegment>
                          );
                        })()}
                        {/* "You'll need a backend" inline suggestion. Only on
                            the most recent assistant message, only when no
                            backend exists yet, and only when the heuristic
                            fires on either the user prompt or Petal's reply. */}
                        {project &&
                          i === messages.length - 1 &&
                          !busy &&
                          !discussBusy &&
                          hasBackend === false &&
                          !dismissedBackendChips.has(i) &&
                          (() => {
                            const prevUser = messages[i - 1]?.role === "user"
                              ? messages[i - 1]?.content
                              : null;
                            const intent = detectBackendIntentInTurn(prevUser, m.content);
                            if (!intent.detected) return null;
                            return (
                              <EnableBackendSuggestionChip
                                projectId={project.id}
                                isPaidPlan={isPaidPlan}
                                reason={intent.reason}
                                onUpgrade={() => setBillingOpen(true)}
                                onDismiss={() =>
                                  setDismissedBackendChips((prev) => {
                                    const next = new Set(prev);
                                    next.add(i);
                                    return next;
                                  })
                                }
                              />
                            );
                          })()}
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    )}
                    {/* Thumbnails of any images attached to this user turn. */}
                    {m.role === "user" && m.attachments && m.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.attachments.map((a, ai) => (
                          <img
                            key={ai}
                            src={a.dataUrl}
                            alt={a.name ?? `attachment ${ai + 1}`}
                            className="h-16 w-16 rounded-md border border-border object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {canRevert && (
                      <button
                        onClick={() => void prepareRevertToMessage(i)}
                        disabled={revertingIndex !== null || revertPreparing !== null}
                        className="absolute -top-2 right-2 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 shadow-sm transition group-hover:opacity-100 hover:text-foreground disabled:opacity-40"
                        title="Preview & revert the project to right after Petal's reply to this message"
                      >
                        {revertingIndex === i || revertPreparing === i ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Undo2 className="h-2.5 w-2.5" />
                        )}
                        Revert to here
                      </button>
                    )}
                  </div>
                  {m.role === "assistant" && i === lastDiscussIndex && !busy && !discussBusy && (
                    <div className="mr-3 mt-1.5 flex justify-end sm:mr-6">
                      <button
                        onClick={applyDiscussedPlan}
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:brightness-105"
                      >
                        <Wand2 className="h-3 w-3" /> Apply this plan
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {discussBusy && (
              <div className="mr-3 inline-flex items-center gap-2 rounded-2xl bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground sm:mr-6">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Petal is thinking…
              </div>
            )}
            {/* Bridge state: busy but no streamed content yet. Without this
                the chat goes blank for ~300ms after send while triage warms
                up — which feels like a freeze. */}
            {busy &&
              !streamingPreamble &&
              !streamingPlan &&
              !streamingAssistant &&
              !streamingRecap && (
                <div className="mr-3 inline-flex items-center gap-2 rounded-2xl bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground sm:mr-6">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Petal is thinking…
                </div>
              )}
            {/* Live, token-by-token reply while Petal works. Promoted to a real
                message in `messages` once the run completes. */}
            {busy &&
              (streamingPreamble ||
                streamingPlan ||
                streamingAssistant ||
                streamingRecap) && (
              <div className="mr-3 overflow-hidden wrap-anywhere rounded-2xl bg-secondary text-foreground px-3.5 py-2.5 text-sm leading-relaxed sm:mr-6">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>petal</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-primary">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {streamingRecap
                      ? "wrapping up"
                      : streamingAssistant
                        ? "writing"
                        : streamingPlan
                          ? "planning"
                          : "thinking"}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {/* Warm conversational preamble — always shown plain, never
                      hidden behind a chip. This is the first thing the user
                      reads and it sets the tone for the whole turn. */}
                  {streamingPreamble && (() => {
                    const safePreamble = sanitizeNarrative(streamingPreamble);
                    return (
                      <Suspense
                        fallback={<div className="whitespace-pre-wrap">{safePreamble}</div>}
                      >
                        <MarkdownMessage content={safePreamble} />
                      </Suspense>
                    );
                  })()}
                  {streamingPlan && (() => {
                    const safePlan = sanitizeNarrative(streamingPlan);
                    return (
                      <CollapsibleSegment
                        label="Plan"
                        tone="primary"
                        icon={<Wand2 className="h-2.5 w-2.5" />}
                        defaultOpen={false}
                      >
                        <Suspense
                          fallback={<div className="whitespace-pre-wrap text-[13px]">{safePlan}</div>}
                        >
                          <MarkdownMessage content={safePlan} />
                        </Suspense>
                      </CollapsibleSegment>
                    );
                  })()}
                  {streamingAssistant && (() => {
                    const safeAssistant = sanitizeNarrative(streamingAssistant);
                    return (
                      <Suspense
                        fallback={<div className="whitespace-pre-wrap">{safeAssistant}</div>}
                      >
                        <MarkdownMessage content={safeAssistant} />
                      </Suspense>
                    );
                  })()}
                  {streamingRecap && (() => {
                    const safeRecap = sanitizeNarrative(streamingRecap);
                    return (
                      <CollapsibleSegment
                        label="What changed"
                        tone="muted"
                        icon={<FileText className="h-2.5 w-2.5" />}
                        defaultOpen={true}
                      >
                        <Suspense
                          fallback={<div className="whitespace-pre-wrap text-[13px]">{safeRecap}</div>}
                        >
                          <MarkdownMessage content={safeRecap} />
                        </Suspense>
                      </CollapsibleSegment>
                    );
                  })()}
                </div>
              </div>
            )}
            {activityVisible && (
              <BuildActivityCard
                phases={phases}
                isActive={busy || isDeploying}
                isComplete={isLive}
                error={friendlyError}
                designCaption={designCaption}
                latestPath={latestPath}
                filesWritten={filesWritten}
                writtenPaths={writtenPaths}
                finalFileLines={finalFileLines}
                fileChanges={fileChanges}
                deployElapsedSec={deployElapsed}
                onStop={busy ? stopGeneration : undefined}
                onRetry={
                  // The "Publishing is taking longer" stall card retries the
                  // deploy directly. Every other retryable error replays the
                  // last user prompt through the AI.
                  isDeploying && friendlyError?.title?.startsWith("Publishing is taking")
                    ? retryDeploy
                    : lastUserPrompt
                      ? retry
                      : undefined
                }
                onAskFix={askPetalToFix}
                onDismissError={() => setFriendlyError(null)}
              />
            )}
            <div ref={chatEndRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPrompt(input);
            }}
            className="safe-bottom border-t border-border bg-card p-3"
          >
            {/* Queued messages — shown when the user typed while Petal was busy. */}
            {pendingQueue.length > 0 && (
              <div className="mb-2 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Up next ({pendingQueue.length})
                </div>
                <div className="space-y-1">
                  {pendingQueue.map((q, qi) => (
                    <div
                      key={q.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", q.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = e.dataTransfer.getData("text/plain");
                        if (fromId) reorderQueueByDrag(fromId, q.id);
                      }}
                      className="group flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background/60 px-2 py-1 text-xs transition hover:border-border/80"
                    >
                      <span
                        className="grid h-5 w-3 shrink-0 cursor-grab place-items-center text-muted-foreground/60 transition hover:text-foreground active:cursor-grabbing"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-3 w-3" />
                      </span>
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded ${
                          q.mode === "discuss"
                            ? "bg-foreground/10 text-foreground/70"
                            : "bg-primary/15 text-primary"
                        }`}
                        title={q.mode === "discuss" ? "Will chat (no file changes)" : "Will build"}
                      >
                        {q.mode === "discuss" ? (
                          <MessageSquare className="h-2.5 w-2.5" />
                        ) : (
                          <Hammer className="h-2.5 w-2.5" />
                        )}
                      </span>
                      <span className="flex-1 truncate text-foreground/80" title={q.text}>
                        {q.text}
                      </span>
                      <div className="flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => moveInQueue(q.id, -1)}
                          disabled={qi === 0}
                          className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          title="Move up"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveInQueue(q.id, 1)}
                          disabled={qi === pendingQueue.length - 1}
                          className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                          title="Move down"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromQueue(q.id)}
                          className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
                          title="Remove from queue"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Pending attachments — chips above the toolbar so the user
                sees what they're about to send. */}
            {pendingAttachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pendingAttachments.map((a, ai) => (
                  <span
                    key={ai}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-1 pr-2 text-[11px] text-muted-foreground"
                  >
                    <img
                      src={a.dataUrl}
                      alt=""
                      className="h-5 w-5 rounded-full object-cover"
                    />
                    <span className="max-w-[110px] truncate">{a.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((_, i) => i !== ai))
                      }
                      className="grid h-4 w-4 place-items-center rounded-full hover:bg-muted"
                      aria-label={`Remove ${a.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={composerFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!files.length) return;
                const remaining = MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
                if (remaining <= 0) {
                  toast.error(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`);
                  return;
                }
                try {
                  const encoded = await encodeAttachments(files.slice(0, remaining));
                  if (encoded.length > 0) {
                    setPendingAttachments((prev) => [...prev, ...encoded]);
                  }
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Couldn't read image");
                }
              }}
            />
            {/* Build / Discuss mode toggle + attach button. */}
            <div className="mb-2 flex items-center justify-between">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => composerFileInputRef.current?.click()}
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="Attach a screenshot or photo"
                  aria-label="Attach an image"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                </button>
                <div className="inline-flex items-center rounded-full border border-border bg-background p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setMode("build")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                      mode === "build"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Petal will write code and update your app"
                  >
                    <Hammer className="h-3 w-3" /> Build
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("discuss")}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                      mode === "discuss"
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="Chat about changes without touching your files"
                  >
                    <MessageSquare className="h-3 w-3" /> Discuss
                  </button>
                </div>
              </div>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {busy || discussBusy
                  ? "Petal is working — your next message will queue"
                  : pendingAttachments.length > 0
                    ? `${pendingAttachments.length} image${pendingAttachments.length > 1 ? "s" : ""} attached`
                    : mode === "discuss"
                      ? "Chat only · no file changes"
                      : "Petal will edit files"}
              </span>
              {mode === "build" && (
                <PreflightCostChip prompt={input} disabled={busy || discussBusy} />
              )}
              {project?.custom_instructions && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary transition hover:brightness-110"
                  title="Project knowledge is active"
                >
                  <BookOpen className="h-2.5 w-2.5" /> knowledge active
                </button>
              )}
            </div>
            <div
              className={`flex items-end gap-2 rounded-2xl border bg-background p-2 focus-within:border-primary ${
                mode === "discuss" ? "border-foreground/20" : "border-border"
              }`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitPrompt(input);
                  }
                }}
                placeholder={
                  busy || discussBusy
                    ? "Type to queue your next message…"
                    : mode === "discuss"
                      ? "Ask Petal anything about your app…"
                      : files.length
                        ? "Ask for a change…"
                        : "Describe the app you want to build…"
                }
                rows={2}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                disabled={bootstrapping}
              />
              <button
                type="submit"
                disabled={bootstrapping || !input.trim()}
                className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-105 disabled:opacity-40"
                title={
                  busy || discussBusy
                    ? "Add to queue"
                    : mode === "discuss"
                      ? "Send (chat only)"
                      : "Send (build changes)"
                }
              >
                {mode === "discuss" ? (
                  <MessageSquare className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            {/* Errors are shown inside <BuildActivityCard /> with friendly copy. */}
          </form>
        </aside>

        {/* Workspace */}
        <main
          className={`min-h-0 flex-col bg-background md:flex ${
            mobileTab === "preview" ? "flex" : "hidden md:flex"
          }`}
        >
          {view === "preview" ? (
            <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
              {/* Device-frame toggle. Desktop only — on mobile the viewport
                  is already the device. Doesn't reload the iframe; just
                  resizes its wrapper, so state is preserved when switching. */}
              {!isMobile && files.length > 0 && (
                <div className="mb-2 flex items-center justify-center gap-1">
                  <div className="inline-flex items-center rounded-full border border-border bg-background p-0.5 text-[11px]">
                    {(
                      [
                        { id: "phone", label: "Phone", icon: Smartphone },
                        { id: "tablet", label: "Tablet", icon: Tablet },
                        { id: "desktop", label: "Desktop", icon: Monitor },
                      ] as const
                    ).map((opt) => {
                      const Icon = opt.icon;
                      const active = previewDevice === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setPreviewDevice(opt.id)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                            active
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          title={`Preview at ${opt.label.toLowerCase()} width`}
                          aria-pressed={active}
                        >
                          <Icon className="h-3 w-3" /> {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-auto">
                <div
                  className={`flex min-h-0 w-full overflow-hidden rounded-2xl border border-border bg-white transition-[max-width] duration-200 ${
                    isMobile
                      ? ""
                      : previewDevice === "phone"
                        ? "max-w-[390px]"
                        : previewDevice === "tablet"
                          ? "max-w-[820px]"
                          : "max-w-none"
                  }`}
                >
                  {useDeployedFallback ? (
                    <Suspense
                      fallback={
                        <div className="grid h-full place-items-center text-xs text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      }
                    >
                      <MobilePreviewFallback
                        projectId={project?.id ?? null}
                        latestBuildId={project?.latest_build_id ?? null}
                        isGenerating={busy}
                      />
                    </Suspense>
                  ) : files.length ? (
                    <Suspense
                      fallback={
                        <div className="grid h-full place-items-center text-xs text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      }
                    >
                      <WebContainerPreview
                        files={files}
                        reloadKey={previewKey}
                        onPick={(el) => {
                          setPickedElement(el);
                          setPickInstruction("");
                        }}
                      />
                    </Suspense>
                  ) : (
                    <EmptyPreview />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[140px_1fr] sm:grid-cols-[200px_1fr]">
              <div className="min-h-0 overflow-y-auto border-r border-border bg-sidebar/40">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Files
                </div>
                {files.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No files yet.</div>
                )}
                {files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => setActiveFile(f.path)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                      activeFile === f.path
                        ? "bg-card font-medium"
                        : "text-muted-foreground hover:bg-card/60"
                    }`}
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    {f.path}
                  </button>
                ))}
              </div>
              <div className="min-h-0 overflow-hidden bg-card">
                {activeFile ? (
                  <Suspense
                    fallback={
                      <div className="grid h-full place-items-center text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    }
                  >
                    <CodeEditor
                      path={activeFile}
                      value={activeContent}
                      onChange={(next) => {
                        setFiles((prev) =>
                          prev.map((f) => (f.path === activeFile ? { ...f, content: next } : f)),
                        );
                      }}
                      onBlur={async () => {
                        if (!project) return;
                        try {
                          await saveProjectFiles(project.id, files);
                        } catch (e) {
                          toast.error("Couldn't save edits");
                          console.error(e);
                        }
                      }}
                    />
                  </Suspense>
                ) : (
                  <div className="grid h-full place-items-center p-6 text-xs text-muted-foreground">
                    Select a file to edit.
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} />
        </Suspense>
      )}
      <RevertPreviewDialog
        open={revertPreview !== null}
        onOpenChange={(o) => {
          if (!o && revertingIndex === null) setRevertPreview(null);
        }}
        title="Revert to this message"
        description={
          revertPreview
            ? `Restore the project to right after Petal's reply to "${revertPreview.label}". Any later messages and edits will be removed. Your current state is saved as a snapshot first — this is non-destructive.`
            : ""
        }
        currentFiles={files}
        targetFiles={revertPreview?.targetFiles ?? []}
        busy={revertingIndex !== null}
        onConfirm={commitRevertToMessage}
        confirmLabel="Revert to here"
      />
      {pickedElement && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
          onClick={() => setPickedElement(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg">Edit this element</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tell Petal what to change. We'll include the element's details automatically.
                </p>
              </div>
              <button
                onClick={() => setPickedElement(null)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
              <code className="text-foreground">&lt;{pickedElement.tag}&gt;</code>
              {pickedElement.text && (
                <> · "<span className="text-foreground">{pickedElement.text.slice(0, 60)}</span>"</>
              )}
              {pickedElement.id && <> · #{pickedElement.id}</>}
            </div>
            <textarea
              autoFocus
              value={pickInstruction}
              onChange={(e) => setPickInstruction(e.target.value)}
              placeholder="Make it larger and pink…"
              rows={3}
              className="mt-3 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!pickInstruction.trim()) return;
                  const el = pickedElement;
                  const lines: string[] = [
                    `Edit a single element in the preview:`,
                    `- Tag: <${el.tag}>`,
                  ];
                  if (el.text) lines.push(`- Visible text: "${el.text}"`);
                  if (el.id) lines.push(`- id: ${el.id}`);
                  if (el.classes) lines.push(`- className: ${el.classes}`);
                  if (el.role) lines.push(`- role: ${el.role}`);
                  if (el.ariaLabel) lines.push(`- aria-label: ${el.ariaLabel}`);
                  if (el.sourceFile) {
                    lines.push(`- Source file: ${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ""}`);
                  }
                  lines.push("", `Change requested: ${pickInstruction.trim()}`);
                  lines.push("", `Find this exact element in the project and apply the change. Make the smallest possible edit; do not redesign other parts of the app.`);
                  submitPrompt(lines.join("\n"));
                  setPickedElement(null);
                  setPickInstruction("");
                }
              }}
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPickedElement(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  disabled={!pickInstruction.trim()}
                  onClick={() => {
                    const el = pickedElement;
                    if (!el) return;
                    const lines: string[] = [
                      `Edit a single element in the preview:`,
                      `- Tag: <${el.tag}>`,
                    ];
                    if (el.text) lines.push(`- Visible text: "${el.text}"`);
                    if (el.id) lines.push(`- id: ${el.id}`);
                    if (el.classes) lines.push(`- className: ${el.classes}`);
                    if (el.role) lines.push(`- role: ${el.role}`);
                    if (el.ariaLabel) lines.push(`- aria-label: ${el.ariaLabel}`);
                    if (el.sourceFile) {
                      lines.push(`- Source file: ${el.sourceFile}${el.sourceLine ? `:${el.sourceLine}` : ""}`);
                    }
                    lines.push("", `Change requested: ${pickInstruction.trim()}`);
                    lines.push("", `Find this exact element in the project and apply the change. Make the smallest possible edit; do not redesign other parts of the app.`);
                    submitPrompt(lines.join("\n"));
                    setPickedElement(null);
                    setPickInstruction("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-40"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Send to Petal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyPreview() {
  return (
    <div className="m-auto max-w-md p-10 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-butter">
        <Sparkles className="h-6 w-6 text-foreground/70" />
      </div>
      <h3 className="mt-4 font-display text-2xl">Your app will appear here</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Send a message in the chat to generate your first project. Petal will write the files and
        reload this preview automatically.
      </p>
      <Link
        to="/projects"
        className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5" /> Back to projects
      </Link>
    </div>
  );
}
