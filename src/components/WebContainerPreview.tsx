import { useEffect, useRef, useState } from "react";
import { Loader2, Terminal, RotateCw, AlertCircle, Smartphone, MousePointerClick, X } from "lucide-react";
import type { ProjectFile } from "@/server/generate.server";
import { detectUnsupportedWebContainerBrowser } from "@/lib/browser-support";
import { PreviewCrashFallback } from "@/components/PreviewCrashFallback";
import {
  ensurePickerInstalled,
  getContainer,
  installDeps,
  mountProject,
  startDevServer,
  stopDevServer,
  subscribeLogs,
  subscribeServer,
} from "@/lib/webcontainer";

export type PickedElement = {
  tag: string;
  id: string | null;
  classes: string | null;
  text: string;
  role: string | null;
  ariaLabel: string | null;
  sourceFile: string | null;
  sourceLine: string | null;
};

export type RuntimeError = {
  message: string;
  stack: string | null;
  source: string | null;
  lineno: number | null;
  colno: number | null;
  kind: "error" | "unhandledrejection" | "blank";
};

type Phase = "idle" | "booting" | "installing" | "starting" | "ready" | "error" | "unsupported";

export function detectUnsupportedBrowser(): string | null {
  return detectUnsupportedWebContainerBrowser();
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;



export function WebContainerPreview({
  files,
  reloadKey,
  onPick,
  onRuntimeError,
  onAskRepair,
  onBootFailed,
  lastNarration,
}: {
  files: ProjectFile[];
  /** Bump this number to force the iframe to reload (e.g. after restoring a version). */
  reloadKey: number;
  /** Called when a user picks an element via the in-iframe overlay. */
  onPick?: (el: PickedElement) => void;
  /** Called when the running app throws a runtime error or unhandled rejection. */
  onRuntimeError?: (err: RuntimeError) => void;
  /** Plan #3 — user clicked "Ask Petal to repair" on the crash fallback. */
  onAskRepair?: (reason: string) => void;
  /** P0-E — WebContainer boot/install/dev rejected. Parent should fall
   *  back to the deployed CDN preview instead of leaving the user on the
   *  error card. Fired once per mount. */
  onBootFailed?: (reason: string) => void;
  /** Plan #3 — last build narration to surface on the crash fallback as context. */
  lastNarration?: string | null;
}) {

  const [phase, setPhase] = useState<Phase>("idle");
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [pickActive, setPickActive] = useState(false);
  // Plan #3 — preview-crash detection. When the running app throws 2+ runtime
  // errors within 5s we consider it a hard crash and swap the iframe for
  // PreviewCrashFallback. Reload clears the state and remounts.
  const [crashReason, setCrashReason] = useState<string | null>(null);
  const crashWindowRef = useRef<number[]>([]);
  // Set to a friendly message when the picker has been "armed" for >30s
  // without the iframe acknowledging readiness — usually means the picker
  // script failed to inject (custom index.html, very fast iframe reload, etc).
  const [pickerWarning, setPickerWarning] = useState<string | null>(null);
  // True once we've received `petal:pick:ready` from the iframe at least once
  // for the current iframeKey — used to clear the pending watchdog.
  const pickerReadyRef = useRef(false);
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
          // Inject the element-picker helper. Best-effort — don't fail the boot if this errors.
          const indexHtml = files.find((f) => f.path === "index.html")?.content;
          ensurePickerInstalled(indexHtml).catch(() => {});
          setPhase("ready");
        } else {
          // Subsequent changes: just patch the filesystem, dev server hot-reloads.
          await mountProject(files);
          const indexHtml = files.find((f) => f.path === "index.html")?.content;
          ensurePickerInstalled(indexHtml).catch(() => {});
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

  // Listen for picker messages from the iframe (cross-origin postMessage).
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: string; payload?: unknown } | null;
      if (!data || typeof data !== "object") return;
      // `ready` arrives every time the picker re-attaches (initial mount, HMR
      // full-reload, in-app SPA navigation). Always honor it so the watchdog
      // below knows the picker is alive.
      if (data.type === "petal:pick:ready") {
        pickerReadyRef.current = true;
        setPickerWarning(null);
        return;
      }
      if ((data.type === "petal:runtime:error" || data.type === "petal:preview:blank") && data.payload) {
        const payload = data.payload as RuntimeError;
        onRuntimeError?.(payload);
        if (data.type === "petal:preview:blank") {
          setCrashReason(payload?.message?.slice(0, 240) || "Preview rendered blank");
          return;
        }
        // Plan #3 — sliding-window crash detector. Count errors in last 5s;
        // if 2+ pile up the preview is effectively dead — swap to fallback.
        const now = Date.now();
        crashWindowRef.current = [
          ...crashWindowRef.current.filter((t) => now - t < 5_000),
          now,
        ];
        if (crashWindowRef.current.length >= 2 && !crashReason) {
          setCrashReason(payload?.message?.slice(0, 240) || "Unknown runtime error");
        }
        return;
      }
      if (!onPick) return;
      if (data.type === "petal:pick:selected" && data.payload) {
        onPick(data.payload as PickedElement);
        setPickActive(false);
      } else if (data.type === "petal:pick:cancelled") {
        setPickActive(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onPick, onRuntimeError, crashReason]);

  // Reset the picker-ready flag whenever the iframe is hard-reloaded — the
  // new document needs to send `petal:pick:ready` again to be considered live.
  useEffect(() => {
    pickerReadyRef.current = false;
    setPickerWarning(null);
    // Plan #3 — a fresh iframe load clears the crash state so reloads work.
    setCrashReason(null);
    crashWindowRef.current = [];
  }, [iframeKey]);

  // Push enable/disable into the iframe whenever pickActive flips, AND start
  // a 30s watchdog: if pickActive is true and we never heard `pick:ready`,
  // surface a friendly toast so the user isn't left clicking a dead picker.
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage({ type: pickActive ? "petal:pick:enable" : "petal:pick:disable" }, "*");
    }
    if (!pickActive) {
      setPickerWarning(null);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!pickerReadyRef.current) {
        setPickerWarning(
          "Picker didn't attach. Try reloading the preview, then click the picker again.",
        );
      }
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [pickActive, iframeKey]);

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
          {onPick && (
            <button
              onClick={() => setPickActive((p) => !p)}
              className={`grid h-7 w-7 place-items-center rounded-md border backdrop-blur transition ${
                pickActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/90 text-muted-foreground hover:text-foreground"
              }`}
              title={pickActive ? "Cancel element pick (Esc)" : "Pick an element to edit"}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
            </button>
          )}
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
      {pickActive && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary backdrop-blur">
          Click an element in the preview · Esc to cancel
        </div>
      )}
      {pickerWarning && (
        <div className="pointer-events-auto absolute left-1/2 top-12 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-card/95 px-3 py-1.5 text-[11px] font-medium text-destructive shadow-sm backdrop-blur">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{pickerWarning}</span>
          <button
            type="button"
            onClick={() => setPickerWarning(null)}
            className="ml-1 rounded p-0.5 text-destructive/70 transition hover:bg-destructive/10 hover:text-destructive"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Iframe (or crash fallback) */}
      <div className="relative min-h-0 flex-1">
        {crashReason ? (
          <PreviewCrashFallback
            reason={crashReason}
            lastPath={serverUrl}
            lastNarration={lastNarration}
            onRetry={() => setIframeKey((k) => k + 1)}
            onAskRepair={onAskRepair ? () => onAskRepair(crashReason) : undefined}
          />
        ) : serverUrl ? (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            title="App preview"
            src={serverUrl}
            allow="cross-origin-isolated"
            className="h-full w-full border-0 bg-white"
            onLoad={() => {
              // Each iframe load is either a hard reload, an HMR full-page
              // refresh, or a client-side navigation that swapped the
              // document. The picker script auto-attaches itself on the new
              // document via its embedded <script> tag, but we also need to
              // re-push the current pickActive state so an in-flight pick
              // survives the navigation.
              const win = iframeRef.current?.contentWindow;
              if (!win) return;
              win.postMessage(
                { type: pickActive ? "petal:pick:enable" : "petal:pick:disable" },
                "*",
              );
            }}
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
