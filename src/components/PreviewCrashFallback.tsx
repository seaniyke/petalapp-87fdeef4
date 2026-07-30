import { AlertTriangle, FileCode2, RotateCw, Wrench } from "lucide-react";

/**
 * Plan #3 — Preview crash → static fallback.
 *
 * Renders in place of the live iframe when the preview hits a hard runtime
 * crash (2+ runtime errors in <5s). Shows a friendly summary of the crash
 * plus actions: hard-reload the preview, or ask Petal to repair.
 *
 * Note on "snapshot": the preview iframe is cross-origin (WebContainer dev
 * server runs on a different origin), so `canvas.drawImage(iframe)` is
 * blocked by CORS and we can't capture a real screenshot from the parent.
 * Instead we surface the last known-good textual context (route path,
 * last narration, last runtime-error message). When/if WebContainer ever
 * exposes a same-origin snapshot API, swap this card to render the
 * IndexedDB-cached image alongside.
 */
export function PreviewCrashFallback({
  reason,
  lastPath,
  lastNarration,
  onRetry,
  onAskRepair,
  onOpenFile,
}: {
  reason: string;
  lastPath?: string | null;
  lastNarration?: string | null;
  onRetry: () => void;
  onAskRepair?: () => void;
  /** Jump the code editor to the file the crash points at. */
  onOpenFile?: (path: string) => void;
}) {
  const cause = plainCause(reason);
  const culprit = fileFromError(reason) ?? lastPath ?? null;

  return (
    <div className="grid h-full w-full place-items-center bg-aurora p-6">
      <div className="w-full max-w-sm rounded-2xl border border-destructive/30 bg-card/95 p-5 shadow-sm backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-bold text-foreground">Preview stopped</h3>
        </div>
        <p className="text-xs font-medium leading-relaxed text-muted-foreground">
          {cause} Your code is safe — only the live preview stopped. Reload first; if it happens
          again, let Petal fix it.
        </p>


        <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-2.5 text-[11px] leading-relaxed">
          <div className="font-mono text-destructive break-words line-clamp-3">{reason}</div>
          {(lastPath || lastNarration) && (
            <div className="mt-2 space-y-0.5 text-muted-foreground">
              {lastPath && (
                <div>
                  <span className="opacity-60">Last route:</span> {lastPath}
                </div>
              )}
              {lastNarration && (
                <div>
                  <span className="opacity-60">Last build step:</span> {lastNarration}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-bold text-foreground transition hover:bg-muted"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Reload preview
          </button>
          {onAskRepair && (
            <button
              type="button"
              onClick={onAskRepair}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:opacity-90"
            >
              <Wrench className="h-3.5 w-3.5" />
              Ask Petal to fix it
            </button>
          )}
          {culprit && onOpenFile && (
            <button
              type="button"
              onClick={() => onOpenFile(culprit)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-bold text-foreground transition hover:bg-muted"
            >
              <FileCode2 className="h-3.5 w-3.5" />
              Open {culprit.split("/").pop()}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Turn a raw runtime error into something a non-developer can act on. */
function plainCause(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("syntaxerror") || r.includes("unexpected token"))
    return "There's a typo in the code Petal just wrote.";
  if (r.includes("failed to resolve") || r.includes("cannot find module"))
    return "A file or package the app imports is missing.";
  if (r.includes("is not defined") || r.includes("is not a function"))
    return "Something the page uses hasn't been created yet.";
  if (r.includes("install") || r.includes("npm") || r.includes("enoent"))
    return "Installing the app's packages didn't finish.";
  if (r.includes("undefined") && r.includes("reading"))
    return "The page tried to read data that isn't there yet.";
  return "The running app hit an error it couldn't recover from.";
}

/** Best-effort file path from a stack trace / build error. */
function fileFromError(reason: string): string | null {
  const m = reason.match(/((?:src|app)\/[\w./-]+\.(?:tsx?|jsx?|css))/);
  return m ? m[1] : null;
}

