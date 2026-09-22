/**
 * The single card shown when a turn finishes.
 *
 * It replaces the old stack of post-build cards (status, cost, what's next):
 * one headline, one line of plain summary, three actions, and everything
 * else tucked behind "Details".
 */
import { useState } from "react";
import { CheckCircle2, Eye, Rocket, Wand2, ChevronRight } from "lucide-react";

type Props = {
  /** Credits charged for this turn, if settled. */
  credits?: number | null;
  /** One short line describing what changed. */
  summary?: string | null;
  /** Hide "See it live" when the preview is already on screen. */
  showPreview?: boolean;
  onPreview?: () => void;
  onPublish?: () => void;
  onKeepBuilding?: () => void;
  onDetails?: () => void;
  /** Up to three follow-up ideas, revealed under "Keep building". */
  suggestions?: string[];
  onSuggest?: (prompt: string) => void;
};

function creditLabel(credits: number | null | undefined): string | null {
  if (typeof credits !== "number" || credits <= 0) return null;
  if (credits === 1) return "1 credit";
  return `${credits.toFixed(credits < 10 ? 1 : 0)} credits`;
}

export function BuildResultCard({
  credits,
  summary,
  showPreview = true,
  onPreview,
  onPublish,
  onKeepBuilding,
  onDetails,
  suggestions,
  onSuggest,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const ideas = (suggestions ?? []).slice(0, 3);
  const cost = creditLabel(credits);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-2.5 px-3.5 pb-2.5 pt-3">
        <span
          className="mt-[1px] inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600"
          aria-hidden
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14.5px] font-bold tracking-[-0.01em]">
              Your app is ready
            </span>
            {cost && (
              <span className="ml-auto shrink-0 font-mono text-[10.5px] font-semibold text-muted-foreground/70 tabular-nums">
                {cost}
              </span>
            )}
          </div>
          {summary && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] font-medium text-muted-foreground">
              {summary}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-1.5 px-2 pb-2 @[24rem]:grid-cols-3">
        {showPreview && (
          <Action icon={<Eye className="h-3.5 w-3.5" />} label="See it live" onClick={onPreview} />
        )}
        <Action icon={<Rocket className="h-3.5 w-3.5" />} label="Publish" onClick={onPublish} />
        <Action
          icon={<Wand2 className="h-3.5 w-3.5" />}
          label="Keep building"
          onClick={() => {
            if (ideas.length > 0) setExpanded((v) => !v);
            else onKeepBuilding?.();
          }}
        />
      </div>

      {ideas.length > 0 && expanded && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2.5">
          {ideas.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest?.(s)}
              className="inline-flex items-center rounded-full border border-foreground/15 bg-background px-3 py-1.5 text-[12.5px] font-medium transition hover:border-foreground/30 hover:bg-foreground hover:text-background"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {onDetails && (
        <button
          type="button"
          onClick={onDetails}
          className="flex w-full items-center justify-between border-t border-border/60 px-3.5 py-2 text-[12.5px] font-semibold text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
        >
          Details
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function Action({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-[13px] font-bold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}
