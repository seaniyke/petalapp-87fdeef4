/**
 * Clarifying-question checklist.
 *
 * When Petal pauses mid-build because it needs a decision from the user,
 * it presents a short checklist of options. The user ticks the boxes they
 * want and hits "Add to message" — the chosen lines are dropped into the
 * composer (joined with commas) so they can tweak before sending. Never
 * auto-submits; the user is always in control of the final message.
 */
import { useState } from "react";
import { Check, ListChecks } from "lucide-react";

type Props = {
  options: string[];
  /** Called with the assembled text once the user submits the checklist. */
  onPick: (text: string) => void;
  /** Optional question header so the card reads as a real "Petal asks" moment. */
  question?: string;
};

export function SuggestionChecklist({ options, onPick, question }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const submit = () => {
    const chosen = [...selected].sort().map((i) => options[i]).filter(Boolean);
    if (chosen.length === 0) return;
    onPick(chosen.join(", "));
    setSubmitted(true);
  };

  return (
    <div
      className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-300"
      role="group"
      aria-label="Petal needs a quick answer"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3.5 py-2 text-[11.5px] font-medium text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        <span>{question ?? "Petal needs a quick answer — tick what fits"}</span>
      </div>

      <ul className="divide-y divide-border/50">
        {options.map((opt, i) => {
          const on = selected.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={submitted}
                aria-pressed={on}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-[13px] leading-snug transition ${
                  on
                    ? "bg-primary/[0.06] text-foreground"
                    : "text-foreground/85 hover:bg-foreground/[0.04]"
                } disabled:cursor-default disabled:opacity-70`}
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background"
                  }`}
                  aria-hidden
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span>{opt}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {selected.size === 0
            ? "Pick one or more"
            : `${selected.size} selected`}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={selected.size === 0 || submitted}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground px-3 text-[11.5px] font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitted ? "Added to message" : "Add to message"}
        </button>
      </div>
    </div>
  );
}
