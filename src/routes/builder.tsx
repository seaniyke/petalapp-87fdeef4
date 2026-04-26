import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import JSZip from "jszip";
import { streamGenerate } from "@/lib/stream";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { buildPreviewDoc } from "@/lib/preview";
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
import { toast } from "sonner";

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
  const initialSent = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const previewDoc = useMemo(() => buildPreviewDoc(files), [files]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

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

  async function send(content: string) {
    const text = content.trim();
    if (!text || busy || !project) return;
    setError(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages: ChatMessage[] = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const result = await generateProject({
        data: { messages: nextMessages, currentFiles: files },
      });
      const assistantMsg: ChatMessage = { role: "assistant", content: result.summary };
      setFiles(result.files);
      setActiveFile((prev) => prev ?? "index.html");
      setMessages((prev) => [...prev, assistantMsg]);
      setPreviewKey((k) => k + 1);

      // Persist
      try {
        await Promise.all([
          saveProjectFiles(project.id, result.files),
          appendMessages(project.id, [userMsg, assistantMsg]),
          maybeAutoTitleProject(project, result.summary, text),
          createVersion(project.id, result.files, {
            origin: "auto",
            label: text.slice(0, 60),
            summary: result.summary,
          }),
        ]);
        setHistoryKey((k) => k + 1);
        // Refresh project meta so title/summary in the UI stay current
        const refreshed = await getProject(project.id);
        if (refreshed) setProject(refreshed);
      } catch (persistErr) {
        console.error(persistErr);
        toast.error("Generated, but couldn't save changes.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setError(msg);
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function downloadProject() {
    if (!files.length) return;
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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/70 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            to="/projects"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Projects
          </Link>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-display text-base">{project?.title ?? "Loading…"}</span>
              {project?.summary && (
                <span className="line-clamp-1 max-w-[280px] text-[11px] text-muted-foreground">
                  {project.summary}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-background p-0.5 text-sm">
            <button
              onClick={() => setView("preview")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 transition ${
                view === "preview" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button
              onClick={() => setView("code")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 transition ${
                view === "code" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" /> Code
            </button>
          </div>
          <button
            onClick={() => setPreviewKey((k) => k + 1)}
            disabled={!files.length}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted disabled:opacity-40"
            title="Reload preview"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          {project && (
            <HistoryPanel
              projectId={project.id}
              currentFiles={files}
              onRestore={handleRestore}
              refreshKey={historyKey}
            />
          )}
          <button
            onClick={downloadProject}
            disabled={!files.length}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export .zip
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_1fr]">
        {/* Chat */}
        <aside className="flex min-h-0 flex-col border-b border-border bg-sidebar md:border-b-0 md:border-r">
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
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.role === "user" ? "you" : "petal"}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            {busy && (
              <div className="mr-6 inline-flex items-center gap-2 rounded-2xl bg-mint/50 px-3.5 py-2.5 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Petal is building…
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
              <div className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </form>
        </aside>

        {/* Workspace */}
        <main className="flex min-h-0 flex-col bg-background">
          {view === "preview" ? (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-white">
                {files.length ? (
                  <iframe
                    key={previewKey}
                    title="preview"
                    sandbox="allow-scripts allow-forms allow-modals"
                    srcDoc={previewDoc}
                    className="h-full w-full"
                  />
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
              <div className="min-h-0 overflow-auto bg-card">
                <textarea
                  value={activeContent}
                  onChange={(e) => {
                    if (!activeFile) return;
                    setFiles((prev) =>
                      prev.map((f) =>
                        f.path === activeFile ? { ...f, content: e.target.value } : f
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
                  spellCheck={false}
                  className="h-full min-h-[400px] w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed outline-none"
                  placeholder="Select a file to edit."
                />
              </div>
            </div>
          )}
        </main>
      </div>
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
