/**
 * Build cost summary — shown after every successful build.
 *
 * Kimble Credit System v2: every deduction must feel earned, so we always
 * explain the charge in user language and never expose token counts.
 */
import { Check } from "lucide-react";
import {
  buildCostReasons,
  costFootnote,
  formatBuildCost,
} from "@/lib/build-cost-summary";

type Props = {
  credits: number | null | undefined;
  fileCount?: number;
  paths?: string[];
  verified?: boolean;
  className?: string;
};

export function BuildCostSummary({
  credits,
  fileCount,
  paths,
  verified,
  className,
}: Props) {
  if (typeof credits !== "number") return null;
  const reasons = buildCostReasons({ credits, fileCount, paths, verified });

  return (
    <div
      className={`rounded-xl border border-border/60 bg-muted/40 p-3 text-[12px] ${className ?? ""}`}
    >
      <p className="flex items-center gap-1.5 font-bold">
        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
        Build completed
      </p>
      <p className="mt-1 font-bold tabular-nums">
        Credits used: {formatBuildCost(credits)}
      </p>
      {reasons.length > 0 && (
        <>
          <p className="mt-2 font-medium text-muted-foreground">Why:</p>
          <ul className="mt-1 space-y-0.5">
            {reasons.map((r) => (
              <li key={r} className="flex gap-1.5 font-medium text-muted-foreground">
                <span aria-hidden>•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 font-medium text-muted-foreground">{costFootnote(credits)}</p>
    </div>
  );
}
