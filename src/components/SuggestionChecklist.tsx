/**
 * Lovable-style clarifying-question card.
 *
 * Petal asks at most one question per turn and ships 2–4 short answer options.
 * This card renders them as radio rows (single-select), plus a "Write your
 * own…" row with an inline input. Footer has prev/next arrows (disabled in
 * single-question mode for visual parity), a muted "Skip all" link, and a
 * primary "Next"/"Review" pill that submits the chosen answer.
 *
 * Non-blocking: the composer stays enabled. This card is just the easy path.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type Props = {
  options: string[];
  /** Submit the chosen (or typed) answer. */
  onSend: (text: string) => void;
  /** Dismiss the question without sending a reply. */
  onSkip: () => void;
  /** Optional question header. Falls back to "Pick an option". */
  question?: string;
  /** Disables interaction while a request is in flight. */
  pending?: boolean;
  /** Once true, the card locks into a "sent" state. */
  answered?: boolean;
  /** Controls "Next" vs "Review" pill copy. Defaults true. */
  isLast?: boolean;
};

export function SuggestionChecklist({
  options,
  onSend,
  onSkip,
  question,
  pending,
  answered,
  isLast = true,
}: Props) {
  // selectedIndex === options.length means the "Write your own…" row.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [customText, setCustomText] = useState("");
  const customRef = useRef<HTMLInputElement | null>(null);

  const customIndex = options.length;
  const disabled = !!answered || !!pending;

  useEffect(() => {
    if (selectedIndex === customIndex) {
      customRef.current?.focus();
    }
  }, [selectedIndex, customIndex]);

  const resolved =
    selectedIndex === null
      ? ""
      : selectedIndex === customIndex
        ? customText.trim()
        : options[selectedIndex] ?? "";

  const canSend = !disabled && resolved.length > 0;

  const submit = () => {
    if (!canSend) return;
    onSend(resolved);
  };

  return (
    <div
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-300"
      role="group"
      aria-label="Pick an answer"
    >
      {/* Question title */}
      <div className="px-4 pt-3.5 pb-2 text-[13.5px] font-medium leading-snug text-foreground">
        {question?.trim() || "Pick an option"}
      </div>

      {/* Options */}
      <ul className="px-2 pb-1">
        {options.map((opt, i) => {
          const on = selectedIndex === i;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => setSelectedIndex(i)}
                disabled={disabled}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition ${
                  on ? "bg-muted/60 text-foreground" : "text-foreground/85 hover:bg-muted/40"
                } disabled:cursor-default disabled:opacity-70`}
              >
                <Radio on={on} />
                <span className="flex-1">{opt}</span>
              </button>
            </li>
          );
        })}

        {/* Write your own… row */}
        <li>
          <div
            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 transition ${
              selectedIndex === customIndex ? "bg-muted/60" : "hover:bg-muted/40"
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedIndex(customIndex)}
              disabled={disabled}
              aria-pressed={selectedIndex === customIndex}
              className="shrink-0 disabled:cursor-default disabled:opacity-70"
            >
              <Radio on={selectedIndex === customIndex} />
            </button>
            <input
              ref={customRef}
              value={customText}
              onChange={(e) => {
                setCustomText(e.target.value);
                if (e.target.value.length > 0) setSelectedIndex(customIndex);
              }}
              onFocus={() => setSelectedIndex(customIndex)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={disabled}
              placeholder="Write your own…"
              className="flex-1 bg-transparent text-[13px] leading-snug text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-60"
            />
          </div>
        </li>
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled
            aria-label="Previous question"
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted/50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Next question"
            className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted/50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={disabled}
            className="text-[12px] text-muted-foreground transition hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            Skip all
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12px] font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            {answered ? "Sent" : pending ? "Sending…" : isLast ? "Review" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border transition ${
        on ? "border-primary" : "border-border"
      }`}
    >
      {on && <span className="h-2 w-2 rounded-full bg-primary" />}
    </span>
  );
}
