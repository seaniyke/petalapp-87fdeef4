/**
 * Build-target picker — single pill under the composer that opens a
 * popover with options. Replaces the previous chip rail (which overflowed
 * on mobile and felt busy). Inspired by Google AI Studio's "Build an
 * Android app" affordance.
 *
 * Selection is persisted per-project to localStorage and surfaced to the
 * parent via `onChange`. Defaults to "web" (no extra prompt steering).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Hammer } from "lucide-react";
import {
  BUILD_TARGETS,
  type BuildTargetId,
  buildTargetStorageKey,
  getBuildTarget,
} from "@/lib/build-targets";

type Props = {
  projectId?: string | null;
  value?: BuildTargetId;
  onChange?: (id: BuildTargetId) => void;
  /** Compact variant for the builder composer (smaller pill). */
  compact?: boolean;
};

export function BuildTargetChips({ projectId, value, onChange, compact = false }: Props) {
  const [internal, setInternal] = useState<BuildTargetId>("web");
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Hydrate from localStorage when uncontrolled.
  useEffect(() => {
    if (value !== undefined) return;
    try {
      const stored = localStorage.getItem(buildTargetStorageKey(projectId));
      if (stored) setInternal(stored as BuildTargetId);
    } catch {
      /* ignore */
    }
  }, [projectId, value]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Auto-flip: drop down when there isn't enough room above the trigger.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const POPOVER = 340; // matches max-h
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    setPlacement(spaceAbove < POPOVER && spaceBelow > spaceAbove ? "bottom" : "top");
  }, [open]);


  const current = value ?? internal;
  const active = getBuildTarget(current);

  const pick = (id: BuildTargetId) => {
    if (value === undefined) setInternal(id);
    try {
      localStorage.setItem(buildTargetStorageKey(projectId), id);
    } catch {
      /* ignore */
    }
    onChange?.(id);
    setOpen(false);
  };

  const isDefault = current === "web";
  const pillSize = compact ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3 text-[12.5px]";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border transition ${pillSize} ${
          isDefault
            ? "border-border/60 bg-muted/30 text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground"
            : "border-foreground/70 bg-foreground/[0.08] text-foreground"
        }`}
        title="Pick what you're building"
      >
        <Hammer className="h-3 w-3 opacity-80" aria-hidden />
        <span className="leading-none">{active.menuLabel}</span>
        <ChevronDown
          className={`h-3 w-3 opacity-60 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 w-[15rem] max-h-[min(55vh,340px)] overflow-y-auto origin-bottom-left rounded-2xl border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-150"
        >
          {BUILD_TARGETS.map((t) => {
            const on = current === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                role="option"
                aria-selected={on}
                className={`flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left text-[12px] leading-snug transition ${
                  on ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.05]"
                }`}
              >
                <span aria-hidden className="mt-0.5 text-sm leading-none">
                  {t.glyph || "✨"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground truncate">
                    {t.menuLabel}
                  </span>
                  <span className="block text-[10.5px] text-muted-foreground truncate">
                    {t.hint}
                  </span>
                </span>
                {on && (
                  <Check className="mt-0.5 h-3.5 w-3.5 text-foreground shrink-0" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
