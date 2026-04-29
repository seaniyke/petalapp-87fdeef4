/**
 * Post-build "What's next?" card. Shown under the most recent assistant
 * message after a successful build so users always know what to do next:
 *   • See it live (jump to preview)
 *   • Publish it
 *   • Keep building (focus the composer)
 *
 * Petal-style: warm copy, big tap targets, no jargon. Replaces the silent
 * moment after a build finishes that left users wondering what to do.
 */
import { Eye, Rocket, Wand2 } from "lucide-react";

type Props = {
  onPreview: () => void;
  onPublish: () => void;
  onKeepBuilding: () => void;
  showPreviewAction: boolean;
};

export function NextStepsCard({
  onPreview,
  onPublish,
  onKeepBuilding,
  showPreviewAction,
}: Props) {
  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-background to-muted/40 p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Ready — what's next?
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {showPreviewAction && (
          <button
            type="button"
            onClick={onPreview}
            className="group flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left transition hover:border-foreground/30 hover:shadow-sm"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-background">
              <Eye className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold leading-tight">See it live</span>
              <span className="block text-[11px] text-muted-foreground">Open the preview</span>
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onPublish}
          className="group flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left transition hover:border-foreground/30 hover:shadow-sm"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <Rocket className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold leading-tight">Publish</span>
            <span className="block text-[11px] text-muted-foreground">Share it with the world</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onKeepBuilding}
          className="group flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left transition hover:border-foreground/30 hover:shadow-sm"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <Wand2 className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold leading-tight">Keep building</span>
            <span className="block text-[11px] text-muted-foreground">Ask Petal for more</span>
          </span>
        </button>
      </div>
    </div>
  );
}
