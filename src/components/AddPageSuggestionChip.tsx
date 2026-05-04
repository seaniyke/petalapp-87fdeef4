/**
 * AddPageSuggestionChip — inline CTA when Petal detects the user is
 * thinking about extra pages (About, Pricing, Contact, Blog, …).
 *
 * Petal's stack (TanStack Start, file-based routing) supports true
 * multi-page sites with proper SSR + per-page SEO out of the box. The
 * gap is discoverability: users default to one-pagers because they
 * don't know they can ask. Tapping a quick option pre-fills the
 * composer with a clear, scaffold-ready prompt.
 */
import { FileText, X } from "lucide-react";
import { useState } from "react";

type Props = {
  reason?: string;
  onPrefill: (prompt: string) => void;
  onDismiss: () => void;
};

const QUICK_PAGES: { label: string; prompt: string }[] = [
  { label: "About", prompt: "Add a proper /about page with a short story, what we believe, and the people behind this. Link it from the main nav." },
  { label: "Pricing", prompt: "Add a /pricing page with three tiers, a feature comparison, and a clear primary CTA. Link it from the main nav." },
  { label: "Contact", prompt: "Add a /contact page with a working contact form (name, email, message) and quick links to email and social. Link it from the main nav." },
  { label: "Blog", prompt: "Add a /blog index page that lists posts, plus a /blog/$slug detail route. Use 3 sample posts. Link Blog from the main nav." },
  { label: "FAQ", prompt: "Add a /faq page using an accordion with 8 realistic questions for this product. Link it from the footer." },
];

export function AddPageSuggestionChip({ reason, onPrefill, onDismiss }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-foreground">
          Petal can split this into proper pages{reason ? ` (${reason})` : ""} — better SEO, shareable URLs, real navigation.
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          Add a page
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
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_PAGES.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onPrefill(p.prompt);
                setOpen(false);
              }}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground transition hover:border-primary/40 hover:bg-card"
            >
              + {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
