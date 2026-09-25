import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";
import { getProductProgress, type ProductProgressItem } from "@/lib/product-progress.functions";

type Progress = { productName: string; completed: number; total: number; items: ProductProgressItem[] };

const MARK: Record<ProductProgressItem["status"], { sym: string; text: string }> = {
  COMPLETED: { sym: "✓", text: "Done" },
  IN_PROGRESS: { sym: "◐", text: "Built, being checked" },
  NOT_STARTED: { sym: "○", text: "Remaining" },
  BLOCKED: { sym: "⚠", text: "Needs you" },
  REJECTED: { sym: "–", text: "Removed" },
  SUPERSEDED: { sym: "–", text: "Replaced" },
};

/** Real requirement progress from the project's saved product plan. */
export function ProductProgress({ projectId, refreshKey }: { projectId?: string | null; refreshKey?: unknown }) {
  const fetchProgress = useServerFn(getProductProgress);
  const [data, setData] = useState<Progress | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    fetchProgress({ data: { projectId } })
      .then((p) => alive && setData(p as Progress | null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, refreshKey, fetchProgress]);

  if (!data || data.total < 2) return null;

  return (
    <div className="mx-2 mb-2 rounded-xl border border-border/60 bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-semibold"
        aria-expanded={open}
      >
        <span className="truncate">
          {data.productName} — {data.completed}/{data.total} done
        </span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="space-y-1 px-3 pb-2.5">
          {data.items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span aria-hidden className="w-3 text-center text-foreground">{MARK[it.status].sym}</span>
              <span className="truncate text-foreground">{it.label}</span>
              <span className="ml-auto shrink-0 text-[11px]">{MARK[it.status].text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
