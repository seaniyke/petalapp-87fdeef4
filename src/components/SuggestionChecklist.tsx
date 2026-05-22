/**
 * Clarifying-question quick replies.
 *
 * When Petal asks a question and offers options, tapping an option drops
 * the text into the composer so the user can tweak it before sending —
 * never auto-submits on click.
 */
import { Sparkles } from "lucide-react";

type Props = {
  options: string[];
  /** Called when the user taps a suggestion. Receives the option text. */
  onPick: (text: string) => void;
};

export function SuggestionChecklist({ options, onPick }: Props) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(opt)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-[12.5px] text-foreground/85 transition hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <Sparkles className="h-3 w-3 opacity-60" aria-hidden />
          <span className="leading-snug">{opt}</span>
        </button>
      ))}
    </div>
  );
}
