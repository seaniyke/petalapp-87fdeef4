/**
 * Mobile kit, part 2 — native-feel interaction primitives.
 *
 * `scaffold-kit-mobile.ts` gives a shell (safe area, header, tab bar,
 * pull-to-refresh). That is enough to look mobile-ish but not enough to FEEL
 * native: generated mobile apps kept rendering desktop cards in a phone
 * frame. This file adds the pieces that actually carry the native feel —
 * grouped list rows, a segmented control, an action sheet, a FAB, swipe
 * actions, sticky bottom bars, and mobile-shaped empty/loading states.
 *
 * Constraints (same as part 1):
 *  - ≤ 120 lines / 6 KB per file.
 *  - React + lucide-react + cn + tailwind only.
 *  - PascalCase exports, every component accepts className.
 *  - Lands at src/components/mobile/*.
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// =============================================================================
// ListRow + ListGroup — iOS-style grouped list rows
// =============================================================================
const LIST_ROW = `import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Grouped list — the single most common native pattern. Wrap rows in
 * <ListGroup label="Account"> and use <ListRow> for each line.
 */
export function ListGroup({
  label,
  footnote,
  className,
  children,
}: {
  label?: string;
  footnote?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn("w-full", className)}>
      {label ? (
        <h2 className="px-4 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h2>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {children}
      </div>
      {footnote ? <p className="px-4 pt-2 text-xs text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  leading,
  trailing,
  onClick,
  destructive,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  className?: string;
}) {
  const interactive = typeof onClick === "function";
  const Comp: React.ElementType = interactive ? "button" : "div";
  return (
    <Comp
      {...(interactive ? { type: "button", onClick } : {})}
      className={cn(
        "flex w-full min-h-[56px] items-center gap-3 px-4 py-3 text-left",
        interactive && "transition-colors active:bg-muted",
        className,
      )}
    >
      {leading ? <span className="shrink-0 text-muted-foreground">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px] font-medium", destructive && "text-destructive")}>
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {value ? <span className="shrink-0 text-[15px] tabular-nums text-muted-foreground">{value}</span> : null}
      {trailing ?? (interactive ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null)}
    </Comp>
  );
}
`;

// =============================================================================
// SegmentedControl — iOS segmented tabs
// =============================================================================
const SEGMENTED = `import * as React from "react";
import { cn } from "@/lib/utils";

/** iOS-style segmented control. Use for 2-4 mutually exclusive views. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn("flex w-full gap-1 rounded-xl bg-muted p-1", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-[36px] flex-1 rounded-lg px-3 text-[13px] font-semibold transition-all",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground active:scale-[0.98]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
`;

// =============================================================================
// ActionSheet — bottom sheet with a drag affordance
// =============================================================================
const ACTION_SHEET = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface SheetAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  Icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Native-style bottom sheet. Always renders an opaque surface + scrim so it
 * can never be see-through, and locks body scroll while open.
 */
export function ActionSheet({
  open,
  onClose,
  title,
  actions,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions?: SheetAction[];
  children?: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Actions"}
        className={cn(
          "relative w-full rounded-t-3xl border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl",
          className,
        )}
      >
        <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        {title ? <h2 className="px-5 pt-4 text-base font-semibold">{title}</h2> : null}
        {children ? <div className="px-5 py-4">{children}</div> : null}
        {actions?.length ? (
          <div className="mt-2 divide-y divide-border border-t border-border">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  a.onSelect();
                  onClose();
                }}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-3 px-5 text-[15px] font-medium active:bg-muted",
                  a.destructive && "text-destructive",
                )}
              >
                {a.Icon ? <a.Icon className="size-4" /> : null}
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
`;

// =============================================================================
// FloatingActionButton + StickyActionBar
// =============================================================================
const FAB = `import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Thumb-reachable primary action. Sits above the tab bar and safe area. */
export function FloatingActionButton({
  onClick,
  label,
  Icon = Plus,
  className,
}: {
  onClick: () => void;
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95",
        className,
      )}
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
    >
      <Icon className="size-6" />
    </button>
  );
}

/** Sticky bottom bar for the primary action on forms and detail screens. */
export function StickyActionBar({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 -mx-4 mt-6 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur",
        className,
      )}
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {children}
    </div>
  );
}
`;

// =============================================================================
// SwipeRow — swipe-to-action list row
// =============================================================================
const SWIPE_ROW = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Swipe a row left to reveal one action (delete, archive, complete).
 * Pointer-event based so it works with touch and mouse, and it degrades to a
 * plain row when the user never swipes.
 */
export function SwipeRow({
  onAction,
  actionLabel = "Delete",
  destructive = true,
  className,
  children,
}: {
  onAction: () => void;
  actionLabel?: string;
  destructive?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [dx, setDx] = React.useState(0);
  const start = React.useRef<number | null>(null);
  const WIDTH = 88;

  const end = () => {
    if (start.current === null) return;
    start.current = null;
    setDx((d) => (d < -WIDTH * 0.6 ? -WIDTH : 0));
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => {
          setDx(0);
          onAction();
        }}
        className={cn(
          "absolute inset-y-0 right-0 flex w-[88px] items-center justify-center text-sm font-semibold text-primary-foreground",
          destructive ? "bg-destructive" : "bg-primary",
        )}
      >
        {actionLabel}
      </button>
      <div
        onPointerDown={(e) => {
          start.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          const next = Math.min(0, Math.max(-WIDTH, e.clientX - start.current + (dx === -WIDTH ? -WIDTH : 0)));
          setDx(next);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        className="relative bg-card transition-transform"
        style={{ transform: \`translateX(\${dx}px)\`, touchAction: "pan-y" }}
      >
        {children}
      </div>
    </div>
  );
}
`;

// =============================================================================
// MobileStates — skeleton list + empty state, phone-shaped
// =============================================================================
const MOBILE_STATES = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Skeleton rows sized like real list rows, so nothing jumps on load. */
export function MobileListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-[56px] items-center gap-3 px-4 py-3">
          <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Designed empty state with one primary action — never a blank screen. */
export function MobileEmptyState({
  Icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  Icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-8 py-16 text-center", className)}>
      {Icon ? (
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted">
          <Icon className="size-6 text-muted-foreground" />
        </span>
      ) : null}
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-[36ch] text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 min-h-[44px] rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Inline error with a retry — the third required state. */
export function MobileErrorState({
  message = "Something went wrong loading this.",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("mx-4 rounded-2xl border border-border bg-card p-5 text-center", className)}>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-[44px] rounded-xl border border-border px-4 text-sm font-semibold active:bg-muted"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
`;

export const KIT_BLOCK_FILES_MOBILE_2: KitFile[] = [
  { path: "src/components/mobile/list-row.tsx", content: LIST_ROW, overwrite: true },
  { path: "src/components/mobile/segmented-control.tsx", content: SEGMENTED, overwrite: true },
  { path: "src/components/mobile/action-sheet.tsx", content: ACTION_SHEET, overwrite: true },
  { path: "src/components/mobile/fab.tsx", content: FAB, overwrite: true },
  { path: "src/components/mobile/swipe-row.tsx", content: SWIPE_ROW, overwrite: true },
  { path: "src/components/mobile/mobile-states.tsx", content: MOBILE_STATES, overwrite: true },
];
