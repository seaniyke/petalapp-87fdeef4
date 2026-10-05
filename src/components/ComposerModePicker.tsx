/**
 * Composer mode picker — small button + popover that swaps between Build,
 * Discuss, and Idea Coach. Replaces the older segmented pill so the composer
 * toolbar stays roomy on a 430px viewport.
 *
 * The button shows the active mode's icon + label and a chevron. Tapping it
 * opens a popover with a short hint on each option; "Help me think" carries a
 * muted "½ credit/turn" suffix so pricing is honest at the moment of choice.
 */
import { Hammer, MessageSquare, Lightbulb, ChevronDown, Check } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComposerMode = "build" | "discuss" | "coach";

type Option = {
  value: ComposerMode;
  label: string;
  Icon: typeof Hammer;
  hint: string;
  /** Tiny suffix shown after the hint, e.g. "½ credit/turn". */
  suffix?: string;
  /** Background tint for the icon tile. */
  tint: string;
};

const OPTIONS: Option[] = [
  {
    value: "build",
    label: "Build",
    Icon: Hammer,
    hint: "Generate or change code.",
    tint: "bg-primary/10 text-primary",
  },
  {
    value: "discuss",
    label: "Discuss",
    Icon: MessageSquare,
    hint: "Chat — no file changes.",
    tint: "bg-foreground/10 text-foreground/80",
  },
  {
    value: "coach",
    label: "Help me think",
    Icon: Lightbulb,
    hint: "Brainstorm an app idea.",
    tint: "bg-lilac/40 text-foreground/80",
  },
];

export function ComposerModePicker({
  value,
  onChange,
  disabled,
}: {
  value: ComposerMode;
  onChange: (next: ComposerMode) => void;
  disabled?: boolean;
}) {
  const active = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  const ActiveIcon = active.Icon;
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-label={`Mode: ${active.label}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-foreground/85 transition",
            "hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <ActiveIcon className="sr-only" aria-hidden />
          <span>{active.label}</span>
          <ChevronDown className="h-4 w-4 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 rounded-lg border-border bg-card p-1.5 shadow-[var(--shadow-soft)]"
        role="menu"
      >
        <ul className="flex flex-col gap-0.5">
          {OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            const isActive = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={cn(
                    "group flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left transition",
                    "hover:bg-muted/70 focus:outline-none focus-visible:bg-muted",
                    isActive && "bg-muted/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md",
                      opt.tint,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight text-foreground">
                      {opt.label}
                      {opt.suffix && (
                        <span className="rounded-full bg-lilac/30 px-1.5 py-0.5 text-[9.5px] font-normal uppercase tracking-wider text-foreground/60">
                          {opt.suffix}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {opt.hint}
                    </span>
                  </span>
                  {isActive && (
                    <Check className="mt-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
