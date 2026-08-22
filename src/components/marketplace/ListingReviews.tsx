import { useCallback, useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { listReviews, submitReview, type PublicReview } from "@/lib/marketplace";

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          style={{ width: size, height: size }}
          className={
            n <= Math.round(value)
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40"
          }
          aria-hidden
        />
      ))}
    </span>
  );
}

export function ListingRating({ avg, count }: { avg: number; count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
      <Stars value={avg} />
      {avg.toFixed(1)} ({count})
    </span>
  );
}

/** Public reviews plus a write form for buyers who own the product. */
export function ListingReviews({
  slug,
  canReview,
  onSubmitted,
}: {
  slug: string;
  canReview: boolean;
  onSubmitted?: () => void;
}) {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setReviews(await listReviews(slug));
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch {
        /* reviews are non-critical */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function handleSubmit() {
    setBusy(true);
    try {
      await submitReview(slug, rating, body.trim());
      toast.success("Thanks — your review is live");
      setBody("");
      await load();
      onSubmitted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your review");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="text-lg font-bold">Reviews</h2>

      {canReview && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-bold">Rate this product</p>
          <div className="mt-2 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                onClick={() => setRating(n)}
                className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Star
                  className={`h-6 w-6 ${
                    n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                  }`}
                  aria-hidden
                />
              </button>
            ))}
          </div>
          <Textarea
            className="mt-3"
            rows={3}
            value={body}
            maxLength={1000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What worked well? What would you tell another builder?"
          />
          <Button className="mt-3" size="sm" disabled={busy} onClick={handleSubmit}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Saving…
              </>
            ) : (
              "Post review"
            )}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid place-items-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : reviews.length === 0 ? (
        <p className="mt-4 text-sm font-medium text-muted-foreground">
          No reviews yet — buyers can rate this product after they open it.
        </p>
      ) : (
        <ul className="mt-5 space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                {r.reviewer_avatar ? (
                  <img
                    src={r.reviewer_avatar}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[11px] font-bold">
                    {r.reviewer_name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <p className="text-sm font-bold">{r.reviewer_name}</p>
                <Stars value={r.rating} />
                <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              {r.body && (
                <p className="mt-2 text-sm font-medium text-muted-foreground">{r.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
