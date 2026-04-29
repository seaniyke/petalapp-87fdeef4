import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Inline single-line item used in the assistant thread for "Plan",
 * "What changed", and similar peripheral sections.
 *
 * Visual goal: feel like a calm activity-log line — small icon, verb-style
 * label, and a tiny chevron that flips on expand. No card chrome, no
 * uppercase tracking, no boxed background. Matches the Lovable-style
 * inline tool/step rows.
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
          "group/seg -ml-0.5 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] font-medium leading-snug transition-colors",
          isPrimary
            ? "text-primary/85 hover:text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 opacity-60 transition-transform duration-150",
            open ? "rotate-90" : "rotate-0",
          )}
        />
        {icon && (
          <span className="grid h-3.5 w-3.5 place-items-center opacity-80">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div className="mt-1.5 ml-[18px] text-[13.5px] leading-relaxed text-foreground/90">
          {children}
        </div>
      )}
    </div>
  );
}
