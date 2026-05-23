/**
 * Required clarifying-question answer card.
 *
 * When Petal asks a question, it pauses and shows this card. The user must
 * either tick one or more options (and/or type a custom answer) and tap
 * "Send answer" to continue, or tap "Skip question" to bypass. The composer
 * is hard-blocked above until one of those happens. On send, the assembled
 * answer is submitted automatically as the user's next message — no manual
 * editing in the composer required.
 */
import { useState } from "react";
import { Check, ListChecks, Loader2 } from "lucide-react";

type Props = {
  options: string[];
  /** Submit the assembled answer (chosen ticks + optional free text). */
  onSend: (text: string) => void;
  /** Dismiss the question without sending a reply. */
  onSkip: () => void;
  /** Optional question header so the card reads as a real "Petal asks" moment. */
  question?: string;
  /** Disables interaction while a request is in flight. */
  pending?: boolean;
  /** Once true, the card locks into a "sent" state. */
  answered?: boolean;
};

export function SuggestionChecklist({
  options,
  onSend,
  onSkip,
  question,
  pending,
  answered,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [freeText, setFreeText] = useState("");

  const toggle = (i: number) => {
    if (answered || pending) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const assembled = (() => {
    const chosen = [...selected].sort((a, b) => a - b).map((i) => options[i]).filter(Boolean);
    const lines: string[] = [];
    if (chosen.length) lines.push(chosen.join(", "));
    const ft = freeText.trim();
    if (ft) lines.push(ft);
    return lines.join("\n");
  })();

  const canSend = !answered && !pending && assembled.length > 0;

  const submit = () => {
    if (!canSend) return;
    onSend(assembled);
  };

  return (
    <div
      className="mt-3 overflow-hidden rounded-2xl border border-primary/40 bg-card/80 shadow-sm ring-1 ring-primary/10 animate-in fade-in slide-in-from-bottom-1 duration-300"
      role="group"
      aria-label="Quick replies — optional"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-primary/[0.06] px-3.5 py-2 text-[11.5px] font-medium text-foreground/80">
        <ListChecks className="h-3.5 w-3.5" />
        <span>{question ?? "Quick replies — tap one or keep typing"}</span>
      </div>

      <ul className="divide-y divide-border/50">
        {options.map((opt, i) => {
          const on = selected.has(i);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={answered || pending}
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

      <div className="border-t border-border/50 bg-background/60 px-3 py-2">
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={answered || pending}
          rows={2}
          placeholder="Add your own answer (optional)…"
          className="min-h-[44px] w-full resize-none rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 text-[13px] outline-none transition focus:border-primary/60 disabled:opacity-60"
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-3 py-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={answered || pending}
          className="text-[11px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline disabled:cursor-default disabled:opacity-50"
        >
          Skip question
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground px-3 text-[11.5px] font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />}
          {answered ? "Answer sent" : pending ? "Sending…" : "Send answer"}
        </button>
      </div>
    </div>
  );
}
