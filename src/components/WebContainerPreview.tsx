import { useEffect, useRef, useState } from "react";
import { Loader2, Terminal, RotateCw, AlertCircle, Smartphone, MousePointerClick, X } from "lucide-react";
import type { ProjectFile } from "@/server/generate.server";
import { detectUnsupportedWebContainerBrowser } from "@/lib/browser-support";
import { PreviewCrashFallback } from "@/components/PreviewCrashFallback";
import {
  resolvePreviewState,
  classifyDevServerFailure,
  type PreviewPhase,
  type PreviewRefusalReason,
} from "@/lib/preview-state";
import {
  ensurePickerInstalled,
  getContainer,
  ensureDeps,
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

type Phase = PreviewPhase;

export function detectUnsupportedBrowser(): string | null {
  return detectUnsupportedWebContainerBrowser();
}

export function WebContainerPreview({
  files,
  reloadKey,
  onPick,
  onRuntimeError,
  onAskRepair,
  onBootFailed,
  lastNarration,
  instantSrc,
  refusedUrl,
  refusedReason,
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
  /** Last deployed build URL. Rendered instantly on open while the sandbox
   *  boots, so the user never stares at "Getting things ready…". */
  instantSrc?: string | null;
  /** C3 — deployed URL the server probe found un-frameable, plus why. Lets us
   *  explain the refusal and offer "Open in new tab" instead of a blank pane. */
  refusedUrl?: string | null;
  refusedReason?: PreviewRefusalReason | null;
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
  // Belt-and-braces for the instant (deployed) preview: if the iframe never
  // fires `load` the host refused the connection — drop it instead of
  // leaving the user staring at a browser error page.
  const [instantDead, setInstantDead] = useState(false);
  // How long we've been in a non-ready phase. Feeds the FSM's "this is taking
  // longer than usual" state so a slow boot reads as slow, not as broken.
  const [elapsedSec, setElapsedSec] = useState(0);
  const crashWindowRef = useRef<number[]>([]);

  useEffect(() => {
    if (phase === "ready" || phase === "idle" || phase === "error" || phase === "unsupported") {
      setElapsedSec(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [phase]);


  // Set to a friendly message when the picker has been "armed" for >30s
  // without the iframe acknowledging readiness — usually means the picker
  // script failed to inject (custom index.html, very fast iframe reload, etc).
  const [pickerWarning, setPickerWarning] = useState<string | null>(null);
  // True once we've received `petal:pick:ready` from the iframe at least once
  // for the current iframeKey — used to clear the pending watchdog.
  const pickerReadyRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bootedRef = useRef(false);
  const devStartedRef = useRef(false);
  const mountedFilesSig = useRef<string>("");
  const mountedManifestRef = useRef<string>("");
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Subscribe to logs + server URL once.
  useEffect(() => {
    const offLogs = subscribeLogs((line) => {
      setLogs((prev) => {
        const next = [...prev, line.text];
        // Cap memory usage.
        return next.length > 500 ? next.slice(-500) : next;
      });
      if (line.stream === "stderr") {
        setShowLogs(true);
        // C4 — a dev server that dies used to leave the user staring at raw
        // stack output in the log drawer. Promote known-fatal output to the
        // FSM's crash state with plain-language wording instead.
        const fatal = classifyDevServerFailure(line.text);
        if (fatal) setCrashReason((prev) => prev ?? fatal);
      }
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

    // Include content, not only length: two edits with equal byte counts still
    // need to reach the running filesystem.
    const sig = files.map((f) => `${f.path}:${f.content}`).join("\u0000");
    const isFirstBoot = !bootedRef.current;
    const filesChanged = sig !== mountedFilesSig.current;
    mountedFilesSig.current = sig;

    if (!isFirstBoot && !filesChanged) return;

    let disposed = false;
    const requestedFiles = files;
    const manifest = files.find((f) => f.path === "package.json")?.content ?? "";
    const runSync = async () => {
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
        }

        await mountProject(requestedFiles);

        // Dependency readiness is part of every manifest change, not merely
        // the first component mount. This covers edits that introduce a new
        // package after Vite is already running.
        if (!devStartedRef.current || manifest !== mountedManifestRef.current) {
          setPhase("installing");
          const code = await ensureDeps();
          if (code !== 0) {
            const msg = `npm install failed (exit ${code}). See logs.`;
            setError(msg);
            setPhase("error");
            setShowLogs(true);
            onBootFailed?.(msg);
            return;
          }
          mountedManifestRef.current = manifest;
        }

        if (!devStartedRef.current) {
          setPhase("starting");
          await startDevServer();
          devStartedRef.current = true;
        }

        // Inject the element-picker helper. Best-effort — don't fail the boot if this errors.
        const indexHtml = requestedFiles.find((f) => f.path === "index.html")?.content;
        ensurePickerInstalled(indexHtml).catch(() => {});
        if (!disposed) setPhase("ready");
      } catch (e) {
        if (disposed) return;
        const msg = e instanceof Error ? e.message : "WebContainer failed to start.";
        setError(msg);
        setPhase("error");
        setShowLogs(true);
        // P0-E — let the parent swap to the deployed CDN preview.
        onBootFailed?.(msg);
      }
    };

    // React effects can fire again while boot/install is still active. Queue
    // snapshots rather than running mount/install/dev concurrently.
    syncQueueRef.current = syncQueueRef.current.then(runSync, runSync);

    return () => {
      disposed = true;
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

  // F1 — one resolved state drives the whole pane. No nested ternaries, no
  // two states rendering at once.
  const view = resolvePreviewState({
    phase,
    serverUrl,
    instantSrc: instantSrc ?? null,
    instantDead,
    refusedReason: refusedReason ?? null,
    refusedUrl: refusedUrl ?? null,
    crashReason,
    error,
    elapsedSec,
  });

  if (view.kind === "unsupported") {
    return (
      <div className="grid h-full w-full place-items-center bg-aurora p-6">
        <div className="max-w-sm rounded-2xl border border-border bg-card/90 p-5 text-center shadow-[var(--shadow-soft)] backdrop-blur">
          <Smartphone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="mb-1 text-sm font-semibold text-foreground">{view.title}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{view.detail}</p>
        </div>
      </div>
    );
  }

  const externalUrl = view.src ?? refusedUrl ?? null;

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Status strip — only when there's nothing to look at yet. */}
      {!view.src && view.kind !== "crashed" && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-card/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
          <div className="inline-flex items-center gap-2">
            {view.warming ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <AlertCircle className="h-3 w-3 text-destructive" />
            )}
            <span>{view.title}</span>
          </div>
          <button
            onClick={() => setShowLogs((s) => !s)}
            className="inline-flex items-center gap-1 rounded-xl px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
          >
            <Terminal className="h-3 w-3" /> {showLogs ? "Hide" : "Show"} logs
          </button>
        </div>
      )}
      {view.kind === "live" && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {onPick && (
            <button
              onClick={() => setPickActive((p) => !p)}
              className={`grid h-7 w-7 place-items-center rounded-xl border backdrop-blur transition ${
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
            className="grid h-7 w-7 place-items-center rounded-xl border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
            title="Reload preview"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowLogs((s) => !s)}
            className="grid h-7 w-7 place-items-center rounded-xl border border-border bg-card/90 text-muted-foreground backdrop-blur transition hover:text-foreground"
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
        <div className="pointer-events-auto absolute left-1/2 top-12 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-destructive/40 bg-card/95 px-3 py-1.5 text-[11px] font-medium text-destructive shadow-[var(--shadow-soft)] backdrop-blur">
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

      {/* Iframe (or the state's card) */}
      <div className="relative min-h-0 flex-1">
        {view.kind === "crashed" ? (
          <PreviewCrashFallback
            reason={view.detail ?? "Unknown runtime error"}
            lastPath={serverUrl}
            lastNarration={lastNarration}
            onRetry={() => setIframeKey((k) => k + 1)}
            onAskRepair={onAskRepair && crashReason ? () => onAskRepair(crashReason) : undefined}
          />
        ) : view.src ? (
          <>
            <iframe
              ref={view.kind === "live" ? iframeRef : undefined}
              key={view.kind === "live" ? iframeKey : "deployed"}
              title="App preview"
              src={view.src}
              allow={view.kind === "live" ? "cross-origin-isolated" : undefined}
              sandbox={
                view.kind === "live"
                  ? undefined
                  : "allow-scripts allow-same-origin allow-forms allow-popups"
              }
              className="h-full w-full border-0 bg-white"
              onLoad={(e) => {
                if (view.kind === "last_deployed") {
                  // A host that refuses the connection paints the browser's
                  // error page; when it fires load at all, the document has
                  // no body content.
                  const doc = (e.currentTarget as HTMLIFrameElement).contentDocument;
                  if (doc && doc.body && doc.body.childElementCount === 0) setInstantDead(true);
                  return;
                }
                // Live: re-push pick state so an in-flight pick survives
                // HMR reloads and client-side navigations.
                const win = iframeRef.current?.contentWindow;
                win?.postMessage(
                  { type: pickActive ? "petal:pick:enable" : "petal:pick:disable" },
                  "*",
                );
              }}
              onError={() => {
                if (view.kind === "last_deployed") setInstantDead(true);
              }}
            />
            {view.warming && (
              <div className="pointer-events-none absolute bottom-2 left-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-[var(--shadow-soft)] backdrop-blur">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Live edits warming up…</span>
              </div>
            )}
            {view.kind === "last_deployed" && !view.warming && view.detail && (
              <div className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-card/95 px-2.5 py-1 text-[11px] font-medium text-amber-700 shadow-[var(--shadow-soft)] backdrop-blur dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                <span>{view.detail}</span>
              </div>
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center bg-aurora p-6">
            <div className="max-w-sm rounded-2xl border border-border bg-card/90 p-5 text-center shadow-[var(--shadow-soft)] backdrop-blur">
              <div className="mb-2 grid place-items-center">
                {view.warming ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                )}
              </div>
              <h3 className="text-sm font-semibold text-foreground">{view.title}</h3>
              {view.detail && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{view.detail}</p>
              )}
              {(view.canRetry || (view.canOpenExternally && externalUrl)) && (
                <div className="mt-3 flex items-center justify-center gap-2">
                  {view.canRetry && (
                    <button
                      type="button"
                      onClick={() => setIframeKey((k) => k + 1)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-1.5 text-[12px] font-semibold transition hover:bg-muted"
                    >
                      <RotateCw className="h-3.5 w-3.5" /> Retry
                    </button>
                  )}
                  {view.canOpenExternally && externalUrl && (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:opacity-90"
                    >
                      Open in new tab
                    </a>
                  )}
                </div>
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


function isCrossOriginIsolated(): boolean {
  return typeof window !== "undefined" && (window as Window).crossOriginIsolated === true;
}
