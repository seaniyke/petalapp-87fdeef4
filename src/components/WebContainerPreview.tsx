import { useEffect, useRef, useState } from "react";
import { Loader2, Terminal, RotateCw, AlertCircle } from "lucide-react";
import type { ProjectFile } from "@/server/generate.server";
import {
  getContainer,
  installDeps,
  mountProject,
  startDevServer,
  stopDevServer,
  subscribeLogs,
  subscribeServer,
} from "@/lib/webcontainer";

type Phase = "idle" | "booting" | "installing" | "starting" | "ready" | "error";

export function WebContainerPreview({
  files,
  reloadKey,
}: {
  files: ProjectFile[];
  /** Bump this number to force the iframe to reload (e.g. after restoring a version). */
  reloadKey: number;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bootedRef = useRef(false);
  const mountedFilesSig = useRef<string>("");

  // Subscribe to logs + server URL once.
  useEffect(() => {
    const offLogs = subscribeLogs((line) => {
      setLogs((prev) => {
        const next = [...prev, line.text];
        // Cap memory usage.
        return next.length > 500 ? next.slice(-500) : next;
      });
      if (line.stream === "stderr") setShowLogs(true);
    });
    const offServer = subscribeServer((url) => setServerUrl(url));
    return () => {
      offLogs();
      offServer();
    };
  }, []);

  // Boot + install + dev when we first receive files. Re-mount on file changes.
  useEffect(() => {
    if (files.length === 0) return;

    // Quick signature so we don't remount on identical files (e.g. parent re-render).
    const sig = files.map((f) => `${f.path}:${f.content.length}`).join("|");
    const isFirstBoot = !bootedRef.current;
    const filesChanged = sig !== mountedFilesSig.current;
    mountedFilesSig.current = sig;

    if (!isFirstBoot && !filesChanged) return;

    let cancelled = false;
    (async () => {
      try {
        if (isFirstBoot) {
          bootedRef.current = true;
          if (!isCrossOriginIsolated()) {
            setError(
              "This page isn't cross-origin isolated. WebContainer needs SharedArrayBuffer — refresh the page."
            );
            setPhase("error");
            return;
          }
          setPhase("booting");
          await getContainer();
          setPhase("installing");
          await mountProject(files);
          const code = await installDeps();
          if (cancelled) return;
          if (code !== 0) {
            setError(`npm install failed (exit ${code}). See logs.`);
            setPhase("error");
            setShowLogs(true);
            return;
          }
          setPhase("starting");
          await startDevServer();
          setPhase("ready");
        } else {
          // Subsequent changes: just patch the filesystem, dev server hot-reloads.
          await mountProject(files);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "WebContainer failed to start.");
        setPhase("error");
        setShowLogs(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  // Stop the dev server when this component unmounts (e.g. leaving /builder).
  useEffect(() => {
    return () => {
      stopDevServer();
    };
  }, []);

  // External reload button: hard-reload the iframe.
  useEffect(() => {
    setIframeKey((k) => k + 1);
  }, [reloadKey]);

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Status strip */}
      {phase !== "ready" && phase !== "idle" && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
          <div className="inline-flex items-center gap-2">
            {phase !== "error" && <Loader2 className="h-3 w-3 animate-spin" />}
            {phase === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
            <span>{phaseLabel(phase)}</span>
          </div>
          <button
            onClick={() => setShowLogs((s) => !s)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
          >
            <Terminal className="h-3 w-3" /> {showLogs ? "Hide" : "Show"} logs
          </button>
        </div>
      )}
      {phase === "ready" && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
            title="Reload preview"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowLogs((s) => !s)}
            className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
            title="Toggle logs"
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Iframe */}
      <div className="relative min-h-0 flex-1">
        {serverUrl ? (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            title="App preview"
            src={serverUrl}
            allow="cross-origin-isolated"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="grid h-full place-items-center bg-aurora text-sm text-muted-foreground">
            <div className="max-w-xs text-center">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {phaseLabel(phase)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Log drawer */}
      {showLogs && (
        <div className="max-h-48 overflow-y-auto border-t border-border bg-foreground/95 px-3 py-2 font-mono text-[11px] leading-snug text-background">
          {logs.length === 0 ? (
            <div className="opacity-60">Waiting for output…</div>
          ) : (
            logs.map((l, i) => (
              <pre key={i} className="whitespace-pre-wrap">
                {l}
              </pre>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "booting":
      return "Booting WebContainer…";
    case "installing":
      return "Installing dependencies…";
    case "starting":
      return "Starting dev server…";
    case "ready":
      return "Ready";
    case "error":
      return "Failed";
    default:
      return "Preparing…";
  }
}

function isCrossOriginIsolated(): boolean {
  return typeof window !== "undefined" && (window as Window).crossOriginIsolated === true;
}
