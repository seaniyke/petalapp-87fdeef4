import { AlertTriangle, RotateCw, Wrench } from "lucide-react";

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
}: {
  reason: string;
  lastPath?: string | null;
  lastNarration?: string | null;
  onRetry: () => void;
  onAskRepair?: () => void;
}) {
  return (
    <div className="grid h-full w-full place-items-center bg-aurora p-6">
      <div className="w-full max-w-sm rounded-2xl border border-destructive/30 bg-card/95 p-5 shadow-sm backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <h3 className="text-sm font-semibold text-foreground">Preview crashed</h3>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The running app threw an unrecoverable error. Your code is safe — only the live
          preview stopped. Try reloading first; if it crashes again, ask Petal to repair.
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
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Reload preview
          </button>
          {onAskRepair && (
            <button
              type="button"
              onClick={onAskRepair}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Wrench className="h-3.5 w-3.5" />
              Ask Petal to repair
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
