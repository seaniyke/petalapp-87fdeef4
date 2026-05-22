/**
 * Chip row that sits under the composer (landing + builder) and lets the
 * user say what they're building. Inspired by Google AI Studio's
 * "Build an Android app" / "Add data" chip rail.
 *
 * Single-select. Tapping a chip toggles it on (or back to "web" if it was
 * already selected). Selection is persisted in localStorage (per project)
 * and surfaced to the parent via `onChange`.
 */
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
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
  /** Compact variant for the builder composer (smaller chips, single row). */
  compact?: boolean;
};

export function BuildTargetChips({ projectId, value, onChange, compact = false }: Props) {
  // Hydrate from localStorage when uncontrolled.
  const [internal, setInternal] = useState<BuildTargetId>("web");
  useEffect(() => {
    if (value !== undefined) return;
    try {
      const stored = localStorage.getItem(buildTargetStorageKey(projectId));
      if (stored) setInternal(stored as BuildTargetId);
    } catch {
      /* localStorage unavailable */
    }
  }, [projectId, value]);

  const current = value ?? internal;
  const active = getBuildTarget(current);

  const pick = (id: BuildTargetId) => {
    const next: BuildTargetId = id === current ? "web" : id;
    if (value === undefined) setInternal(next);
    try {
      localStorage.setItem(buildTargetStorageKey(projectId), next);
    } catch {
      /* ignore */
    }
    onChange?.(next);
  };

  const sizing = compact
    ? "px-2.5 py-1 text-[11.5px]"
    : "px-3 py-1.5 text-[12.5px]";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {BUILD_TARGETS.filter((t) => t.id !== "web").map((t) => {
        const isOn = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border transition ${sizing} ${
              isOn
                ? "border-foreground/70 bg-foreground/[0.08] text-foreground"
                : "border-border/60 bg-muted/30 text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground"
            }`}
            aria-pressed={isOn}
            title={t.hint}
          >
            <span aria-hidden className="text-[13px] leading-none">
              {t.glyph}
            </span>
            <span className="leading-none">{t.label}</span>
            {isOn && <Check className="h-3 w-3" aria-hidden />}
          </button>
        );
      })}
      {current !== "web" && (
        <button
          type="button"
          onClick={() => pick("web")}
          className={`inline-flex items-center gap-1 rounded-full text-muted-foreground hover:text-foreground ${sizing}`}
          aria-label="Clear build target"
          title="Clear"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
      {!compact && current !== "web" && (
        <span className="ml-1 text-[11px] text-muted-foreground/80">{active.hint}</span>
      )}
    </div>
  );
}
