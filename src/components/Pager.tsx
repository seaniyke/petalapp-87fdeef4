/**
 * Pager — one small, consistent way to page through any long list.
 *
 * Deliberately plain: a count on the left ("1–10 of 42"), compact page
 * buttons on the right with ellipses when there are many pages. Hides
 * itself entirely when everything already fits on one page, so short
 * lists stay clean.
 */
import { useMemo, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type PagerProps = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** What the rows are, for the count line. Defaults to "items". */
  noun?: string;
  className?: string;
};

/** Page numbers to show: always first/last, the current one and neighbours. */
export function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pageCount - 1, page + 1);
  if (from > 2) out.push("gap");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pageCount - 1) out.push("gap");
  out.push(pageCount);
  return out;
}

export function Pager({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  noun = "items",
  className,
}: PagerProps) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const window = pageWindow(page, pageCount);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3",
        className,
      )}
    >
      <p className="text-xs font-medium text-muted-foreground tabular-nums">
        {first}–{last} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {window.map((entry, i) =>
          entry === "gap" ? (
            <span
              key={`gap-${i}`}
              className="px-1 text-xs font-medium text-muted-foreground"
              aria-hidden
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? "page" : undefined}
              onClick={() => onPage(entry)}
              className={cn(
                "h-8 min-w-8 rounded-full px-2 text-xs font-bold tabular-nums transition-colors",
                entry === page
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Slice a client-side array into pages and keep the page in range. */
export function usePaged<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const slice = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );

  return { page, setPage, pageCount, total, pageSize, slice };
}
