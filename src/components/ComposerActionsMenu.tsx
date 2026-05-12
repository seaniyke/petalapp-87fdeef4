/**
 * Single "Mode" pill for the composer toolbar. Replaces the old row of
 * Build / Discuss / Deep / Plan pills with one compact trigger that opens a
 * popover. Build is the default; Discuss is the only other exclusive mode.
 * Deep think and Plan first are independent toggles inside the same sheet.
 *
 * Mobile-first: the trigger is ~28px tall so the composer can keep the send
 * button + attach button on the same row without crowding at 430px.
 */
import { Hammer, MessageSquare, Sparkles, ClipboardList, ChevronDown, Check } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComposerBuildMode = "build" | "discuss";

export function ComposerActionsMenu({
  mode,
  onModeChange,
  deepThink,
  onDeepThinkChange,
  planFirst,
  onPlanFirstChange,
  disabled,
}: {
  mode: ComposerBuildMode;
  onModeChange: (next: ComposerBuildMode) => void;
  deepThink: boolean;
  onDeepThinkChange: (next: boolean) => void;
  planFirst: boolean;
  onPlanFirstChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Compose a short label so the user can see active state without opening.
  const baseLabel = mode === "discuss" ? "Discuss" : "Build";
  const modifiers = [deepThink && "Deep", planFirst && "Plan"].filter(Boolean) as string[];
  const ActiveIcon = mode === "discuss" ? MessageSquare : Hammer;
  const accent = mode === "discuss" || deepThink || planFirst;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-label={`Mode: ${baseLabel}${modifiers.length ? ` (${modifiers.join(", ")})` : ""}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition",
            "hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            disabled && "cursor-not-allowed opacity-60",
            accent
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
          )}
        >
          <ActiveIcon className="h-3 w-3" />
          <span>{baseLabel}</span>
          {modifiers.length > 0 && (
            <span className="text-[10px] font-medium opacity-80">· {modifiers.join(" · ")}</span>
          )}
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-72 rounded-2xl border-border bg-card p-1.5 shadow-[var(--shadow-soft)]"
        role="menu"
      >
        <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Mode
        </div>
        <ul className="flex flex-col gap-0.5">
          <ModeRow
            active={mode === "build"}
            Icon={Hammer}
            label="Build"
            hint="Petal writes code and updates your app."
            onClick={() => {
              onModeChange("build");
              setOpen(false);
            }}
          />
          <ModeRow
            active={mode === "discuss"}
            Icon={MessageSquare}
            label="Discuss"
            hint="Chat about changes — no files touched."
            onClick={() => {
              onModeChange("discuss");
              setOpen(false);
            }}
          />
        </ul>
        <div className="my-1.5 h-px bg-border/60" />
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Modifiers
        </div>
        <ul className="flex flex-col gap-0.5">
          <ToggleRow
            active={deepThink}
            Icon={Sparkles}
            label="Deep think"
            hint="Strongest model + extended reasoning. One-shot, costs more."
            onClick={() => onDeepThinkChange(!deepThink)}
          />
          <ToggleRow
            active={planFirst}
            Icon={ClipboardList}
            label="Plan first"
            hint="Propose a scoped plan and wait for approval before editing."
            onClick={() => onPlanFirstChange(!planFirst)}
          />
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ModeRow({
  active,
  Icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  Icon: typeof Hammer;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={active}
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition",
          "hover:bg-muted/70 focus:outline-none focus-visible:bg-muted",
          active && "bg-muted/60",
        )}
      >
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground/10 text-foreground/80">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-tight text-foreground">{label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>
        </span>
        {active && <Check className="mt-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
      </button>
    </li>
  );
}

function ToggleRow({
  active,
  Icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  Icon: typeof Hammer;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={active}
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition",
          "hover:bg-muted/70 focus:outline-none focus-visible:bg-muted",
          active && "bg-muted/60",
        )}
      >
        <span
          className={cn(
            "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
            active ? "bg-primary/15 text-primary" : "bg-foreground/10 text-foreground/70",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-tight text-foreground">{label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>
        </span>
        <span
          className={cn(
            "mt-1 inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition",
            active ? "bg-primary" : "bg-muted-foreground/30",
          )}
          aria-hidden
        >
          <span
            className={cn(
              "h-3 w-3 rounded-full bg-background transition-transform",
              active ? "translate-x-3" : "translate-x-0",
            )}
          />
        </span>
      </button>
    </li>
  );
}
