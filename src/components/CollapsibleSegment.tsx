import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact, collapsible row used to wrap the streaming "Plan" and
 * "What changed" segments inside an assistant chat reply.
 *
 * Visual goal: feel like a refined editorial side-note, not a boxed AI
 * artifact. We intentionally drop the panel chrome (no card backgrounds,
 * no chunky borders) and lean on tight typography + a single hairline
 * divider when expanded.
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
    <div className="select-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group/seg inline-flex w-full items-center gap-1.5 text-left text-[10px] font-bold uppercase tracking-[0.18em] transition-colors",
          isPrimary
            ? "text-primary/85 hover:text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-expanded={open}
      >
        <span
          className={cn(
            "grid h-4 w-4 place-items-center rounded-full",
            isPrimary ? "bg-primary/15 text-primary" : "bg-foreground/10",
          )}
        >
          {icon}
        </span>
        <span>{label}</span>
        <ChevronDown
          className={cn(
            "ml-1 h-3 w-3 shrink-0 transition-transform duration-200",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {open && (
        <div
          className={cn(
            "mt-2 border-l-2 pl-3 text-[13.5px] leading-relaxed",
            isPrimary ? "border-primary/35" : "border-border",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
