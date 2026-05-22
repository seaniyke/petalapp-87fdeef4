/**
 * Multi-select clarifying-question list.
 *
 * When Petal asks a question and offers options, users tick the ones that
 * apply (or just one) and hit Submit. Petal continues only after submit —
 * unlike the older single-tap chips that fired immediately.
 */
import { useState } from "react";
import { Check } from "lucide-react";

type Props = {
  options: string[];
  onSubmit: (picks: string[]) => void;
};

export function SuggestionChecklist({ options, onSubmit }: Props) {
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const submit = () => {
    if (picked.size === 0) return;
    const picks = options.filter((_, i) => picked.has(i));
    onSubmit(picks);
  };

  return (
    <div className="mt-2 rounded-xl border border-border/60 bg-muted/20 p-2.5">
      <ul className="space-y-1">
        {options.map((opt, i) => {
          const isOn = picked.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                  isOn
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-foreground/85 hover:bg-foreground/[0.04]"
                }`}
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
                    isOn
                      ? "border-foreground bg-foreground text-background"
                      : "border-foreground/30 bg-transparent"
                  }`}
                  aria-hidden
                >
                  {isOn && <Check className="h-3 w-3" />}
                </span>
                <span className="leading-snug">{opt}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] text-muted-foreground">
          {picked.size === 0
            ? "Pick one or more"
            : `${picked.size} selected`}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={picked.size === 0}
          className="rounded-full bg-foreground px-3 py-1 text-[11.5px] font-medium text-background transition hover:brightness-110 disabled:bg-foreground/20 disabled:text-foreground/40"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
