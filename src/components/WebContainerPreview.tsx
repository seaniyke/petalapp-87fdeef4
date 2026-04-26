import { useEffect, useRef, useState } from "react";
import { Loader2, Terminal, RotateCw, AlertCircle, Smartphone } from "lucide-react";
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

type Phase = "idle" | "booting" | "installing" | "starting" | "ready" | "error" | "unsupported";

export function detectUnsupportedBrowser(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  // iOS / iPadOS — all browsers there are WebKit. WebContainers technically
  // boot on iOS 16.4+, but installing 200 packages over a phone network
  // reliably exceeds our timeout. Treat as unsupported in the UI.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
  if (isIOS) {
    return "Live preview isn't supported on iOS — open this project on desktop Chrome, Edge, or Firefox to run it.";
  }
  const isAndroid = /Android/.test(ua);
  const isChromium = /Chrome|Chromium|Edg/.test(ua) && !/OPR\//.test(ua);
  if (isAndroid && !isChromium) {
    return "Live preview needs Chrome on Android. Try opening this project on desktop for the best experience.";
  }
  if (typeof SharedArrayBuffer === "undefined") {
    return "Your browser doesn't support SharedArrayBuffer, which is required to run the preview. Try desktop Chrome, Edge, or Firefox.";
  }
  return null;
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;



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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const unsupported = detectUnsupportedBrowser();
          if (unsupported) {
            setError(unsupported);
            setPhase("unsupported");
            return;
          }
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
          // Auto-show logs so users can see install progress instead of a silent spinner.
          setShowLogs(true);
          await mountProject(files);
          // Hard cap install + dev start — surfaces an error instead of spinning forever.
          timeoutRef.current = setTimeout(() => {
            if (cancelled) return;
            setError(
              "Setup is taking longer than 5 minutes. Check the logs below, or try reloading."
            );
            setPhase("error");
            setShowLogs(true);
          }, INSTALL_TIMEOUT_MS);
          const code = await installDeps();
          if (cancelled) return;
          if (code !== 0) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setError(`npm install failed (exit ${code}). See logs.`);
            setPhase("error");
            setShowLogs(true);
            return;
          }
          setPhase("starting");
          await startDevServer();
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPhase("ready");
        } else {
          // Subsequent changes: just patch the filesystem, dev server hot-reloads.
          await mountProject(files);
        }
      } catch (e) {
        if (cancelled) return;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setError(e instanceof Error ? e.message : "WebContainer failed to start.");
        setPhase("error");
        setShowLogs(true);
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
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

  if (phase === "unsupported") {
    return (
      <div className="grid h-full w-full place-items-center bg-aurora p-6">
        <div className="max-w-sm rounded-2xl border border-border bg-card/90 p-5 text-center shadow-sm backdrop-blur">
          <Smartphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="mb-1 text-sm font-semibold text-foreground">Preview not available here</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{error}</p>
          <p className="mt-3 text-[11px] text-muted-foreground/80">
            You can keep editing — your changes are saved and will run as soon as you open this project on a supported
            desktop browser.
          </p>
        </div>
      </div>
    );
  }

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
    case "unsupported":
      return "Not supported";
    default:
      return "Preparing…";
  }
}

function isCrossOriginIsolated(): boolean {
  return typeof window !== "undefined" && (window as Window).crossOriginIsolated === true;
}
