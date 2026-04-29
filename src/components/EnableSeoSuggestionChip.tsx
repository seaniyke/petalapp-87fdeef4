/**
 * EnableSeoSuggestionChip — inline CTA when Petal detects the user wants
 * to be findable / shareable. Doesn't need a backend; opens project
 * settings to the SEO section (or the README hint until that section ships).
 */
import { Search, X } from "lucide-react";

type Props = {
  reason?: string;
  onOpenSeo: () => void;
  onDismiss: () => void;
};

export function EnableSeoSuggestionChip({ reason, onOpenSeo, onDismiss }: Props) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
        Make this {reason ? `(${reason})` : "site"} findable on Google and look great when shared — Petal sets titles, descriptions and share images.
      </span>
      <button
        type="button"
        onClick={onOpenSeo}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
      >
        Set up SEO
      </button>
      <button
        type="button"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
