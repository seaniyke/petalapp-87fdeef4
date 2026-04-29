/**
 * EnableAiFeatureSuggestionChip — appears when the user wants to add an AI
 * capability to their app. Pitches Lovable AI Gateway so Petal doesn't ask
 * for an OpenAI / Claude key. Doesn't need a backend on its own (gateway
 * runs through Petal), though most real features will also persist data.
 */
import { Sparkles, X } from "lucide-react";

type Props = {
  reason?: string;
  onUseGateway: () => void;
  onDismiss: () => void;
};

export function EnableAiFeatureSuggestionChip({ reason, onUseGateway, onDismiss }: Props) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        Use Petal AI for {reason ? `"${reason}"` : "this"} — no OpenAI key needed, billed per use from your wallet.
      </span>
      <button
        type="button"
        onClick={onUseGateway}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
      >
        Use Petal AI
      </button>
      <button
        type="button"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
