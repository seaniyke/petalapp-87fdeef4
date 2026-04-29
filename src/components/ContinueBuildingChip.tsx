/**
 * ContinueBuildingChip — inline CTA shown under an assistant message when
 * Petal deliberately stopped early at a safe boundary (oversize files
 * reverted, continuation pass couldn't finish, hallucinated packages
 * stripped, or the changeset was unusually large). Pre-fills the composer
 * with a continuation prompt so the user can keep going with one click —
 * same UX as Lovable's "Continue building" affordance.
 *
 * Behaviour: clicking "Continue" fills the composer (does NOT auto-submit)
 * so the user stays in control. Clicking the X dismisses the chip.
 */
import { useState } from "react";
import { ArrowRight, X, Sparkles, AlertTriangle } from "lucide-react";

type Props = {
  message: string;
  suggestedPrompt: string;
  onContinue: (prompt: string) => void;
  /** Optional structured detail of what tripped the handoff — rendered as
   *  a small expandable list under the headline so the user knows *what*
   *  Petal detected and stripped/skipped. */
  detected?: {
    hallucinatedPackages?: string[];
    truncatedPaths?: string[];
  };
};

export function ContinueBuildingChip({ message, suggestedPrompt, onContinue, detected }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const pkgs = detected?.hallucinatedPackages ?? [];
  const truncs = detected?.truncatedPaths ?? [];
  const hasDetail = pkgs.length > 0 || truncs.length > 0;

  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          {message}
        </span>
        <button
          type="button"
          onClick={() => {
            onContinue(suggestedPrompt);
            setDismissed(true);
          }}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          Continue <ArrowRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Dismiss continuation suggestion"
          onClick={() => setDismissed(true)}
          className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {hasDetail && (
        <ul className="mt-1.5 space-y-0.5 pl-5 text-[11px] leading-snug text-muted-foreground">
          {pkgs.length > 0 && (
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <span>
                Removed {pkgs.length === 1 ? "import" : "imports"} for unknown package
                {pkgs.length === 1 ? "" : "s"}:{" "}
                <span className="font-mono text-foreground/70">{pkgs.slice(0, 4).join(", ")}</span>
                {pkgs.length > 4 ? ` +${pkgs.length - 4} more` : ""}
              </span>
            </li>
          )}
          {truncs.length > 0 && (
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <span>
                Cut off mid-stream:{" "}
                <span className="font-mono text-foreground/70">
                  {truncs.slice(0, 3).map((p) => p.split("/").pop() ?? p).join(", ")}
                </span>
                {truncs.length > 3 ? ` +${truncs.length - 3} more` : ""}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
