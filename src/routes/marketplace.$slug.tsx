import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Loader2, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { PetalLoader } from "@/components/PetalLoader";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ListingRating, ListingReviews } from "@/components/marketplace/ListingReviews";
import {
  formatListingPrice,
  getLiveListing,
  listLicenses,
  openListingInPetal,
  ownsListing,
  startListingCheckout,
  type LicenseRow,
  type PublicListing,
} from "@/lib/marketplace";

function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Product";
}

export const Route = createFileRoute("/marketplace/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${titleFromSlug(params.slug)} · Petal Marketplace` },
      {
        name: "description",
        content:
          "See what's inside this Petal product — screenshots, license terms and file count — then open it in the builder and make it yours.",
      },
      { property: "og:title", content: `${titleFromSlug(params.slug)} · Petal Marketplace` },
      {
        property: "og:description",
        content: "Open this ready-made app in Petal and customize it.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ListingDetailPage,
});

function ListingDetailPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [license, setLicense] = useState<LicenseRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [owned, setOwned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [found, licenses] = await Promise.all([getLiveListing(slug), listLicenses()]);
        if (cancelled) return;
        setListing(found);
        setLicense(licenses.find((l) => l.code === found?.license_code) ?? null);
        if (found) {
          const { data } = await supabase.auth.getUser();
          if (data.user && !cancelled) setOwned(await ownsListing(found.slug));
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load product");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const canReview = owned || (listing !== null && listing.price_minor === 0);

  async function refreshListing() {
    try {
      const found = await getLiveListing(slug);
      if (found) setListing(found);
    } catch {
      /* rating refresh is best-effort */
    }
  }

  async function handleOpen() {
    if (!listing) return;
    setOpening(true);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        navigate({ to: "/auth", search: { mode: "signin", redirect: `/marketplace/${listing.slug}` } as never });
        return;
      }
      if (listing.price_minor > 0 && !owned) {
        const url = await startListingCheckout(listing.slug);
        // Remember the intent so the return trip can open the product for
        // the buyer instead of making them find the button again.
        try {
          sessionStorage.setItem(`petal:mkt:pending:${listing.slug}`, "1");
        } catch {
          /* private mode — fall back to the manual button */
        }
        window.location.assign(url);
        return;
      }
      const projectId = await openListingInPetal(listing.slug);
      toast.success("Copied into your projects — opening the builder");
      navigate({ to: "/builder", search: { project: projectId } as never });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open this product");
    } finally {
      setOpening(false);
    }
  }

  // Coming back from a completed checkout: the listing is now owned, so
  // deliver it straight away rather than showing an idle button.
  useEffect(() => {
    if (!listing || !owned || opening) return;
    let pending = false;
    try {
      pending = sessionStorage.getItem(`petal:mkt:pending:${listing.slug}`) === "1";
      if (pending) sessionStorage.removeItem(`petal:mkt:pending:${listing.slug}`);
    } catch {
      pending = false;
    }
    if (pending) void handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing, owned]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="grid place-items-center py-32">
          <PetalLoader size={56} label="Loading product…" />
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-6 py-32 text-center">
          <Store className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">This product isn't available</h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            It may have been delisted by its creator.
          </p>
          <Button asChild className="mt-6">
            <Link to="/marketplace">Back to the marketplace</Link>
          </Button>
        </div>
      </div>
    );
  }

  const cover = listing.cover_url ?? listing.screenshots[0] ?? null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link
          to="/marketplace"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Marketplace
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <div className="overflow-hidden rounded-2xl border border-border bg-muted">
              {cover ? (
                <img
                  src={cover}
                  alt={`${listing.title} preview`}
                  className="aspect-[16/10] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[16/10] w-full place-items-center text-muted-foreground">
                  <Store className="h-10 w-10" aria-hidden />
                </div>
              )}
            </div>

            {listing.screenshots.length > 1 && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {listing.screenshots.slice(1, 7).map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt={`${listing.title} screenshot`}
                    loading="lazy"
                    className="aspect-[16/10] w-full rounded-lg border border-border object-cover"
                  />
                ))}
              </div>
            )}

            <h1 className="mt-8 text-3xl font-bold tracking-tight sm:text-4xl">{listing.title}</h1>
            <p className="mt-3 text-base font-medium text-muted-foreground">{listing.pitch}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <ListingRating avg={Number(listing.rating_avg ?? 0)} count={Number(listing.rating_count ?? 0)} />
              {Number(listing.sales_count ?? 0) > 0 && (
                <span className="text-xs font-semibold text-muted-foreground">
                  {listing.sales_count} sold
                </span>
              )}
            </div>

            {listing.description && (
              <div className="mt-6 whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground/90">
                {listing.description}
              </div>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-3xl font-bold tabular-nums">
                {formatListingPrice(listing.price_minor, listing.currency_code)}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {listing.file_count} files · {listing.category.replace("-", " ")}
              </p>
              {owned && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-600">
                  <Check className="h-3.5 w-3.5" aria-hidden /> You own this
                </p>
              )}

              <Button className="mt-4 w-full" onClick={handleOpen} disabled={opening}>
                {opening ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening…
                  </>
                ) : listing.price_minor > 0 && !owned ? (
                  `Buy for ${formatListingPrice(listing.price_minor, listing.currency_code)}`
                ) : (
                  "Open in Petal"
                )}
              </Button>

              {listing.demo_url && (
                <Button asChild variant="outline" className="mt-2 w-full">
                  <a href={listing.demo_url} target="_blank" rel="noreferrer">
                    Live demo <ExternalLink className="ml-2 h-4 w-4" aria-hidden />
                  </a>
                </Button>
              )}

              {license && (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="inline-flex items-center gap-1.5 text-sm font-bold">
                    <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> {license.name}
                  </p>
                  <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                    {license.summary}
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {license.rights.map((r) => (
                      <li key={r} className="flex gap-2 text-xs font-medium text-muted-foreground">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>

        <ListingReviews
          slug={listing.slug}
          canReview={canReview}
          onSubmitted={() => void refreshListing()}
        />
      </main>
    </div>
  );
}
