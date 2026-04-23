import { createFileRoute, Link } from "@tanstack/react-router";
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
} from "lucide-react";
import { generateProject } from "@/server/generate.functions";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { buildPreviewDoc } from "@/lib/preview";

export const Route = createFileRoute("/builder")({
  validateSearch: (search: Record<string, unknown>) => ({
    prompt: typeof search.prompt === "string" ? search.prompt : undefined,
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
  const { prompt: initialPrompt } = Route.useSearch();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("preview");
  const [previewKey, setPreviewKey] = useState(0);
  const initialSent = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const previewDoc = useMemo(() => buildPreviewDoc(files), [files]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  // Auto-send the prompt from the landing page once.
  useEffect(() => {
    if (initialPrompt && !initialSent.current) {
      initialSent.current = true;
      void send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function send(content: string) {
    const text = content.trim();
    if (!text || busy) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const result = await generateProject({
        data: { messages: nextMessages, currentFiles: files },
      });
      setFiles(result.files);
      setActiveFile((prev) => prev ?? "index.html");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.summary },
      ]);
      setPreviewKey((k) => k + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function downloadProject() {
    if (!files.length) return;
    // Combine into a single text dump for now.
    const blob = new Blob(
      [
        files
          .map((f) => `// ===== ${f.path} =====\n${f.content}`)
          .join("\n\n"),
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "petal-project.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeContent = files.find((f) => f.path === activeFile)?.content ?? "";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/70 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="font-display text-lg">Petal Builder</span>
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
          <button
            onClick={downloadProject}
            disabled={!files.length}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export
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
            {messages.length === 0 && !busy && (
              <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
                Describe an app to start. Try “a calm pomodoro timer with stats”
                or “a recipe card generator”.
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-6 bg-card"
                    : "mr-6 bg-butter/60"
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
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
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
    </div>
  );
}
