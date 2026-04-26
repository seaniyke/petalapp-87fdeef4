import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
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
  MoreHorizontal,
  MessageSquare,
  Hammer,
  Wand2,
  Undo2,
  X,
  Zap,
  Gauge,
  Crown,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { streamGenerate } from "@/lib/stream";
import { requestDiscussion } from "@/lib/discuss";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBuildActivity } from "@/hooks/use-build-activity";
import {
  type Phase,
  type PhaseId,
  advanceTo,
  completeThrough,
  defaultPhases,
  markFailed,
} from "@/lib/build-phases";
import { friendlyBuildFailure, toFriendlyError, type FriendlyError } from "@/lib/friendly-errors";
import { BuildActivityCard } from "@/components/BuildActivityCard";

import { supabase } from "@/integrations/supabase/client";
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
import { createVersion, listVersions } from "@/lib/versions";
import { triggerBuild } from "@/lib/builds";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SharePopover } from "@/components/SharePopover";
import { ProjectSettingsSheet } from "@/components/ProjectSettingsSheet";
import { RevertPreviewDialog } from "@/components/RevertPreviewDialog";
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
const WebContainerPreview = lazy(() =>
  import("@/components/WebContainerPreview").then((m) => ({ default: m.WebContainerPreview })),
);
const MobilePreviewFallback = lazy(() =>
  import("@/components/MobilePreviewFallback").then((m) => ({ default: m.MobilePreviewFallback })),
);
type PaletteItem = import("@/components/CommandPalette").PaletteItem;

export const Route = createFileRoute("/builder")({
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const dest = `/builder${search.id ? `?id=${search.id}` : ""}`;
      throw redirect({ to: "/auth", search: { mode: "signin", redirect: dest } });
    }
  },
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
  const { prompt: initialPrompt, id: searchId } = Route.useSearch();
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
  const [latestPath, setLatestPath] = useState<string | undefined>(undefined);
  const [activityVisible, setActivityVisible] = useState(false);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState<string | null>(null);
  // Build vs Discuss mode. Discuss = chat-only, no file changes (Base44/Lovable parity).
  const [mode, setMode] = useState<"build" | "discuss">("build");
  // Smart model routing (Base44's Automatic / Manual). Default = "smart".
  // Persisted per-browser so the choice sticks across sessions.
  type ModelPreset = "fast" | "smart" | "best";
  const [modelPreset, setModelPreset] = useState<ModelPreset>(() => {
    if (typeof window === "undefined") return "smart";
    const v = window.localStorage.getItem("petal:modelPreset");
    return v === "fast" || v === "best" ? v : "smart";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("petal:modelPreset", modelPreset);
    }
  }, [modelPreset]);
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
  const isMobile = useIsMobile();
  const initialSent = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Subscribe to the live Cloudflare build for this project so we can fold
  // its status into the activity feed seamlessly with AI generation.
  const buildSnap = useBuildActivity(project?.latest_build_id ?? null);
  const isDeploying = buildSnap?.status === "pending";
  const isLive = buildSnap?.status === "ready";

  // Reflect Cloudflare build state into the phase timeline + friendly errors.
  useEffect(() => {
    if (!buildSnap) return;
    if (buildSnap.status === "ready") {
      setPhases((p) => completeThrough(p, "live"));
    } else if (buildSnap.status === "pending") {
      setPhases((p) => advanceTo(p, "deploying"));
    } else if (buildSnap.status === "failed") {
      setPhases((p) => markFailed(p, "deploying"));
      setFriendlyError(friendlyBuildFailure(buildSnap.errorMessage));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildSnap?.status, buildSnap?.errorMessage]);

  // Auto-hide the success card a little after the app goes live so the chat
  // returns to a calm state. The card itself also self-collapses.
  useEffect(() => {
    if (!isLive || friendlyError) return;
    const t = setTimeout(() => setActivityVisible(false), 12000);
    return () => clearTimeout(t);
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
    (async () => {
      try {
        if (searchId) {
          const p = await getProject(searchId);
          if (!p) {
            toast.error("Project not found");
            navigate({ to: "/projects" });
            return;
          }
          const [fs, ms] = await Promise.all([loadProjectFiles(p.id), loadProjectMessages(p.id)]);
          if (cancelled) return;
          setProject(p);
          setFiles(fs);
          setMessages(ms);
          setActiveFile(fs.find((f) => f.path === "index.html")?.path ?? fs[0]?.path ?? null);
        } else {
          // Fresh project: create row, then update URL
          const p = await createProject();
          if (cancelled) return;
          setProject(p);
          navigate({
            to: "/builder",
            search: { id: p.id, prompt: initialPrompt },
            replace: true,
          });
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
  }, [searchId]);

  // Auto-send the prompt from the landing page once, after bootstrap.
  useEffect(() => {
    if (
      !bootstrapping &&
      project &&
      initialPrompt &&
      !initialSent.current &&
      messages.length === 0
    ) {
      initialSent.current = true;
      void send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapping, project, initialPrompt]);

  const send = useCallback(
    async (content: string, opts: { isRetry?: boolean } = {}) => {
      const text = content.trim();
      if (!text || busy || !project) return;
      setError(null);
      setFriendlyError(null);
      const userMsg: ChatMessage = { role: "user", content: text };
      // On retry, the failing user message is already in `messages` — don't double-append.
      const nextMessages: ChatMessage[] = opts.isRetry ? messages : [...messages, userMsg];
      if (!opts.isRetry) setMessages(nextMessages);
      setLastUserPrompt(text);
      setInput("");
      setBusy(true);

      // Fresh activity feed for this run.
      setPhases(defaultPhases());
      setDesignCaption("");
      setFilesWritten(0);
      setLatestPath(undefined);
      setActivityVisible(true);

      let resultFiles: ProjectFile[] | null = null;
      let resultSummary = "";
      let streamError: string | null = null;

      // Cancel any prior in-flight request before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamGenerate(
          {
            messages: nextMessages,
            currentFiles: files,
            model: modelPreset,
            customInstructions: project.custom_instructions ?? undefined,
          },
          {
            onPhase: (phase: PhaseId) => {
              setPhases((p) => advanceTo(p, phase));
            },
            onSummaryDelta: (d) => setDesignCaption((s) => s + d),
            onFileProgress: (n, path) => {
              setFilesWritten(n);
              if (path) setLatestPath(path);
            },
            onResult: (f, s) => {
              resultFiles = f;
              resultSummary = s;
            },
            onError: (m) => {
              streamError = m;
            },
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;
        if (streamError) throw new Error(streamError);
        if (!resultFiles) throw new Error("No result returned.");

        const files2: ProjectFile[] = resultFiles;
        const summary2: string = resultSummary || "Updated the project.";
        const assistantMsg: ChatMessage = { role: "assistant", content: summary2 };
        setFiles(files2);
        setActiveFile((prev) => prev ?? "index.html");
        setMessages((prev) => [...prev, assistantMsg]);
        setPreviewKey((k) => k + 1);
        setLastUserPrompt(null);

        // AI work is fully done — mark polishing complete and move to deploying.
        setPhases((p) => completeThrough(p, "polishing"));
        setPhases((p) => advanceTo(p, "deploying"));

        try {
          const persistMsgs: ChatMessage[] = opts.isRetry
            ? [assistantMsg]
            : [userMsg, assistantMsg];
          await Promise.all([
            saveProjectFiles(project.id, files2),
            appendMessages(project.id, persistMsgs),
            maybeAutoTitleProject(project, summary2, text),
            createVersion(project.id, files2, {
              origin: "auto",
              label: text.slice(0, 60),
              summary: summary2,
            }),
          ]);
          setHistoryKey((k) => k + 1);
          const refreshed = await getProject(project.id);
          if (refreshed) setProject(refreshed);

          // Kick off a Cloudflare Pages build. Fire-and-forget — the activity
          // card subscribes to project_builds via useBuildActivity().
          void triggerBuild(project.id)
            .then(async () => {
              const r = await getProject(project.id);
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
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, project, messages, files, modelPreset],
  );

  // Discuss mode: ask Petal a question without touching files. The reply is
  // appended as a normal assistant message and tagged so we can show an
  // "Apply this plan" button under it.
  const discuss = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || busy || discussBusy || !project) return;
      setError(null);
      setFriendlyError(null);
      const userMsg: ChatMessage = { role: "user", content: text };
      const nextMessages: ChatMessage[] = [...messages, userMsg];
      setMessages(nextMessages);
      setInput("");
      setDiscussBusy(true);

      try {
        const reply = await requestDiscussion({
          messages: nextMessages,
          currentFiles: files,
          customInstructions: project.custom_instructions ?? undefined,
        });
        const assistantMsg: ChatMessage = { role: "assistant", content: reply };
        setMessages((prev) => {
          const updated = [...prev, assistantMsg];
          setLastDiscussIndex(updated.length - 1);
          return updated;
        });
        // Persist the conversation so it survives reloads — but don't write
        // any project files (that's the whole point of Discuss).
        try {
          await appendMessages(project.id, [userMsg, assistantMsg]);
        } catch (persistErr) {
          console.error(persistErr);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Discussion failed.";
        toast.error(msg);
        // Roll back the unanswered user message so the chat doesn't look stuck.
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setDiscussBusy(false);
      }
    },
    [busy, discussBusy, project, messages, files],
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
      if (!trimmed || !project || bootstrapping) return;
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
    [project, bootstrapping, busy, discussBusy, mode, discuss, send],
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

  const askPetalToFix = useCallback(() => {
    setFriendlyError(null);
    // Feed the actual build error/log back into the next prompt so the AI
    // can patch the real cause (this is what Lovable, Bolt and Base44 do).
    // The Railway callback already concatenates logs into error_message.
    const rawLog = buildSnap?.errorMessage?.trim();
    const tail = rawLog
      ? rawLog.split("\n").slice(-60).join("\n").slice(-3500)
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
        ].join("\n")
      : "The build failed but no error log was captured. Please review the project files for obvious mistakes (missing imports, syntax errors, typos in package.json) and fix them.";
    void send(prompt, { isRetry: false });
  }, [send, buildSnap]);

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
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/70 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/projects"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Projects</span>
          </Link>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-display text-base" title={project?.title ?? undefined}>
                {project?.title ?? "Loading…"}
              </span>
              {project?.summary && (
                <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                  {project.summary}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
            <div className="hidden md:block">
              <SharePopover project={project} onChange={setProject} />
            </div>
          )}
          {project && (
            <ProjectSettingsSheet
              project={project}
              onChange={setProject}
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
          )}
          <button
            onClick={downloadProject}
            disabled={!files.length}
            className="hidden h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-40 md:inline-flex"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          {/* Mobile overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted md:hidden"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onSelect={() => setPreviewKey((k) => k + 1)}
                disabled={!files.length}
              >
                <RotateCw className="mr-2 h-3.5 w-3.5" /> Reload preview
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                <CommandIcon className="mr-2 h-3.5 w-3.5" /> Commands
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadProject()} disabled={!files.length}>
                <Download className="mr-2 h-3.5 w-3.5" /> Export .zip
              </DropdownMenuItem>
              {project && (
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <BookOpen className="mr-2 h-3.5 w-3.5" /> Project knowledge
                  {project.custom_instructions && (
                    <span
                      aria-hidden
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
                    />
                  )}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile-only tab bar (Chat | Preview). Desktop uses the grid below. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/60 px-3 py-1.5 backdrop-blur md:hidden">
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
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
                <div key={i} className="group">
                  <div
                    className={`relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      isUser ? "ml-6 bg-card" : "mr-6 bg-butter/60"
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
                      <Suspense fallback={<div className="whitespace-pre-wrap">{m.content}</div>}>
                        <MarkdownMessage content={m.content} />
                      </Suspense>
                    ) : (
                      <div className="whitespace-pre-wrap">{m.content}</div>
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
                    <div className="mr-6 mt-1.5 flex justify-end">
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
              <div className="mr-6 inline-flex items-center gap-2 rounded-2xl bg-butter/60 px-3.5 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Petal is thinking…
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
                onStop={busy ? stopGeneration : undefined}
                onRetry={lastUserPrompt ? retry : undefined}
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
            className="border-t border-border bg-card p-3"
          >
            {/* Queued messages — shown when the user typed while Petal was busy. */}
            {pendingQueue.length > 0 && (
              <div className="mb-2 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Up next ({pendingQueue.length})
                </div>
                <div className="space-y-1">
                  {pendingQueue.map((q) => (
                    <div
                      key={q.id}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-background/60 px-2 py-1 text-xs"
                    >
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
                      <button
                        type="button"
                        onClick={() => removeFromQueue(q.id)}
                        className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        title="Remove from queue"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Build / Discuss mode toggle (Base44/Lovable parity). */}
            <div className="mb-2 flex items-center justify-between">
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
              {/* Smart model picker (Base44 Automatic / Manual parity). */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
                  title="Choose how Petal picks its AI model"
                >
                  {modelPreset === "fast" ? (
                    <Zap className="h-3 w-3" />
                  ) : modelPreset === "best" ? (
                    <Crown className="h-3 w-3" />
                  ) : (
                    <Gauge className="h-3 w-3" />
                  )}
                  <span className="capitalize">{modelPreset}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setModelPreset("smart")}>
                    <Gauge className="mr-2 h-3.5 w-3.5" />
                    <div className="flex flex-col">
                      <span className="text-sm">Smart {modelPreset === "smart" && "·"}</span>
                      <span className="text-[10px] text-muted-foreground">
                        Auto-pick: Pro for big changes, Flash otherwise
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setModelPreset("fast")}>
                    <Zap className="mr-2 h-3.5 w-3.5" />
                    <div className="flex flex-col">
                      <span className="text-sm">Fast</span>
                      <span className="text-[10px] text-muted-foreground">
                        Always Flash — quickest + cheapest
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setModelPreset("best")}>
                    <Crown className="mr-2 h-3.5 w-3.5" />
                    <div className="flex flex-col">
                      <span className="text-sm">Best</span>
                      <span className="text-[10px] text-muted-foreground">
                        Always Pro — strongest reasoning
                      </span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {busy || discussBusy
                  ? "Petal is working — your next message will queue"
                  : mode === "discuss"
                    ? "Chat only · no file changes"
                    : "Petal will edit files"}
              </span>
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
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-white">
                {isMobile ? (
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
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
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
