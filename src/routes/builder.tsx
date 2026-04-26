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
  AlertCircle,
  MoreHorizontal,
  Square,
} from "lucide-react";
import { streamGenerate } from "@/lib/stream";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { useIsMobile } from "@/hooks/use-mobile";

import { supabase } from "@/integrations/supabase/client";
import {
  appendMessages,
  createProject,
  getProject,
  loadProjectFiles,
  loadProjectMessages,
  maybeAutoTitleProject,
  saveProjectFiles,
  type ProjectRow,
} from "@/lib/projects";
import { createVersion } from "@/lib/versions";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SharePopover } from "@/components/SharePopover";
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
  import("@/components/CodeEditor").then((m) => ({ default: m.CodeEditor }))
);
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette }))
);
const MarkdownMessage = lazy(() =>
  import("@/components/MarkdownMessage").then((m) => ({ default: m.MarkdownMessage }))
);
const WebContainerPreview = lazy(() =>
  import("@/components/WebContainerPreview").then((m) => ({ default: m.WebContainerPreview }))
);
const MobilePreviewFallback = lazy(() =>
  import("@/components/MobilePreviewFallback").then((m) => ({ default: m.MobilePreviewFallback }))
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
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [streamingSummary, setStreamingSummary] = useState<string>("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [lastUserPrompt, setLastUserPrompt] = useState<string | null>(null);
  // Mobile-only: which panel is visible. On desktop both render side-by-side.
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const [previewHasUpdate, setPreviewHasUpdate] = useState(false);
  const isMobile = useIsMobile();
  const initialSent = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
          const [fs, ms] = await Promise.all([
            loadProjectFiles(p.id),
            loadProjectMessages(p.id),
          ]);
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
      const userMsg: ChatMessage = { role: "user", content: text };
      // On retry, the failing user message is already in `messages` — don't double-append.
      const nextMessages: ChatMessage[] = opts.isRetry
        ? messages
        : [...messages, userMsg];
      if (!opts.isRetry) setMessages(nextMessages);
      setLastUserPrompt(text);
      setInput("");
      setBusy(true);
      setStreamStatus("Thinking…");
      setStreamingSummary("");

      let resultFiles: ProjectFile[] | null = null;
      let resultSummary = "";
      let streamError: string | null = null;

      // Cancel any prior in-flight request before starting a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamGenerate(
          { messages: nextMessages, currentFiles: files },
          {
            onStatus: (m) => setStreamStatus(m),
            onSummaryDelta: (d) => setStreamingSummary((s) => s + d),
            onTool: (name) =>
              setStreamStatus(name === "patch_files" ? "Editing files…" : "Writing project…"),
            onResult: (f, s) => {
              resultFiles = f;
              resultSummary = s;
            },
            onError: (m) => {
              streamError = m;
            },
          },
          controller.signal
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
        } catch (persistErr) {
          console.error(persistErr);
          toast.error("Generated, but couldn't save changes.");
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        setError(msg);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        setStreamStatus("");
        setStreamingSummary("");
      }
    },
    [busy, project, messages, files]
  );

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setStreamStatus("");
    setStreamingSummary("");
  }, []);

  const retry = useCallback(() => {
    if (lastUserPrompt) void send(lastUserPrompt, { isRetry: true });
  }, [lastUserPrompt, send]);

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
    setActiveFile((prev) =>
      restored.find((f) => f.path === prev)?.path ??
      restored.find((f) => f.path === "index.html")?.path ??
      restored[0]?.path ??
      null
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
              <span
                className="truncate font-display text-base"
                title={project?.title ?? undefined}
              >
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
              <DropdownMenuItem onSelect={() => setPreviewKey((k) => k + 1)} disabled={!files.length}>
                <RotateCw className="mr-2 h-3.5 w-3.5" /> Reload preview
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                <CommandIcon className="mr-2 h-3.5 w-3.5" /> Commands
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadProject()} disabled={!files.length}>
                <Download className="mr-2 h-3.5 w-3.5" /> Export .zip
              </DropdownMenuItem>
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
                Describe an app to start. Try "a calm pomodoro timer with stats"
                or "a recipe card generator".
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user" ? "ml-6 bg-card" : "mr-6 bg-butter/60"
                }`}
              >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.role === "user" ? "you" : "petal"}
                </div>
                {m.role === "assistant" ? (
                  <Suspense fallback={<div className="whitespace-pre-wrap">{m.content}</div>}>
                    <MarkdownMessage content={m.content} />
                  </Suspense>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                )}
              </div>
            ))}
            {busy && (
              <div className="mr-6 rounded-2xl bg-mint/50 px-3.5 py-2.5 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {streamStatus || "Petal is building…"}
                  </span>
                  <button
                    type="button"
                    onClick={stopGeneration}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" /> Stop
                  </button>
                </div>
                {streamingSummary && (
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {streamingSummary}
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 -mb-0.5 animate-pulse bg-foreground/40" />
                  </div>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-border bg-card p-3"
          >
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-background p-2 focus-within:border-primary">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={
                  files.length
                    ? "Ask for a change…"
                    : "Describe the app you want to build…"
                }
                rows={2}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                disabled={busy || bootstrapping}
              />
              <button
                type="submit"
                disabled={busy || bootstrapping || !input.trim()}
                className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-105 disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            {error && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium">Generation failed</div>
                  <div className="mt-0.5 break-words opacity-90">{error}</div>
                </div>
                {lastUserPrompt && (
                  <button
                    type="button"
                    onClick={() => retry()}
                    disabled={busy}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-destructive px-2 text-[11px] font-medium text-destructive-foreground transition hover:brightness-110 disabled:opacity-50"
                  >
                    <RefreshCcw className="h-3 w-3" /> Retry
                  </button>
                )}
              </div>
            )}
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
                      files={files}
                      reloadKey={previewKey}
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
                    <WebContainerPreview files={files} reloadKey={previewKey} />
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
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No files yet.
                  </div>
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
                          prev.map((f) =>
                            f.path === activeFile ? { ...f, content: next } : f
                          )
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
        Send a message in the chat to generate your first project. Petal will
        write the files and reload this preview automatically.
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
