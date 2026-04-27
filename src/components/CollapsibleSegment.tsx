import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact, collapsible header used to wrap the streaming "Plan" and
 * "What changed" segments inside an assistant chat bubble. Default state
 * is collapsed so the chat reads cleanly; users click to expand.
 */
export function CollapsibleSegment({
  label,
  icon,
  tone = "muted",
  defaultOpen = false,
  children,
}: {
  label: string;
  icon?: ReactNode;
  tone?: "primary" | "muted";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isPrimary = tone === "primary";
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-1.5",
        isPrimary
          ? "border-primary/15 bg-primary/5"
          : "border-border/60 bg-card/50",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1 text-[9px] font-semibold uppercase tracking-wider",
          isPrimary ? "text-primary/80" : "text-muted-foreground",
          "hover:opacity-80",
        )}
        aria-expanded={open}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown
          className={cn(
            "ml-auto h-3 w-3 shrink-0 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}
