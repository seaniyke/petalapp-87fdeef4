import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search, Store, Tag } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { PetalLoader } from "@/components/PetalLoader";
import { Pager, usePaged } from "@/components/Pager";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ListingRating } from "@/components/marketplace/ListingReviews";
import { useMarketplaceFeature } from "@/hooks/use-marketplace-feature";
import {
  formatListingPrice,
  listLiveListings,
  listMyPurchases,
  type PublicListing,
} from "@/lib/marketplace";

export const Route = createFileRoute("/marketplace/")({
  head: () => ({
    meta: [
      { title: "Marketplace · Buy ready-made apps · Kimble" },
      {
        name: "description",
        content:
          "Browse finished apps, SaaS starters and websites built on Kimble. Open one, make it yours, and ship it the same day.",
      },
      { property: "og:title", content: "Kimble Marketplace" },
      {
        property: "og:description",
        content: "Buy ready-made software you can open and customize in Kimble.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketplaceRoute,
});

function MarketplaceRoute() {
  const { enabled, loading } = useMarketplaceFeature();
  if (loading) return <MarketplaceLoading />;
  if (!enabled) return <MarketplaceUnavailable />;
  return <MarketplacePage />;
}

function MarketplaceLoading() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="grid place-items-center py-32"><PetalLoader size={56} label="Loading…" /></div>
    </div>
  );
}

function MarketplaceUnavailable() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-xl px-6 py-32 text-center">
        <h1 className="text-2xl font-bold">This page isn't available</h1>
        <Button asChild className="mt-6"><Link to="/">Back to Kimble</Link></Button>
      </div>
    </div>
  );
}

function MarketplacePage() {
  const [listings, setListings] = useState<PublicListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof listMyPurchases>>>([]);

  useEffect(() => {
    listLiveListings()
      .then(setListings)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load marketplace"))
      .finally(() => setLoading(false));
    listMyPurchases()
      .then(setLibrary)
      .catch(() => {
        /* signed out — no library */
      });
  }, []);

  const categories = useMemo(() => {
    const set = new Set(listings.map((l) => l.category));
    return ["all", ...Array.from(set).sort()];
  }, [listings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (category !== "all" && l.category !== category) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        l.pitch.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    });
  }, [listings, query, category]);

  const paged = usePaged(filtered, 12);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
          <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-6 pb-14 pt-16 sm:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Software you can own
            </p>
            <h1 className="heading-editorial mt-4 text-5xl sm:text-6xl md:text-7xl">
              The <em>Marketplace</em>.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Finished apps built on Kimble. Pick one, open it in the builder, and
              make it yours — no starting from a blank page.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/sell">
                  <Store className="mr-2 h-4 w-4" /> Sell your app
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/gallery">Browse the gallery</Link>
              </Button>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products"
                className="pl-9"
                aria-label="Search marketplace"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.replace("-", " ")}
                </button>
              ))}
            </div>
          </div>

          {library.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Your library
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {library.map((p) => (
                  <li key={p.id}>
                    <Link
                      to="/marketplace/$slug"
                      params={{ slug: p.listing_slug }}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted/60"
                    >
                      {p.listing_title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-10">
            {loading ? (
              <div className="grid place-items-center py-24">
                <PetalLoader size={56} label="Loading marketplace…" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState hasListings={listings.length > 0} />
            ) : (
              <>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {paged.slice.map((l) => (
                    <ListingCard key={l.id} listing={l} />
                  ))}
                </div>
                <Pager
                  page={paged.page}
                  pageCount={paged.pageCount}
                  total={paged.total}
                  pageSize={paged.pageSize}
                  onPage={paged.setPage}
                  noun="apps"
                  className="mt-6 rounded-2xl border border-border"
                />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function ListingCard({ listing }: { listing: PublicListing }) {
  const cover = listing.cover_url ?? listing.screenshots[0] ?? null;
  return (
    <Link
      to="/marketplace/$slug"
      params={{ slug: listing.slug }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg"
    >
      <div className="aspect-[16/10] w-full overflow-hidden bg-muted">
        {cover ? (
          <img
            src={cover}
            alt={`${listing.title} preview`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <Store className="h-8 w-8" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold leading-snug">{listing.title}</h2>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
            {formatListingPrice(listing.price_minor, listing.currency_code)}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium text-muted-foreground">
          {listing.pitch}
        </p>
        <div className="mt-4 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1 capitalize">
            <Tag className="h-3.5 w-3.5" aria-hidden /> {listing.category.replace("-", " ")}
          </span>
          <span>{listing.file_count} files</span>
          <ListingRating
            avg={Number(listing.rating_avg ?? 0)}
            count={Number(listing.rating_count ?? 0)}
          />

          <span className="ml-auto inline-flex items-center gap-1 text-primary opacity-0 transition-opacity group-hover:opacity-100">
            View <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ hasListings }: { hasListings: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border py-20 text-center">
      <Store className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
      <h2 className="mt-4 text-lg font-bold">
        {hasListings ? "Nothing matches that search" : "The marketplace is just opening"}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm font-medium text-muted-foreground">
        {hasListings
          ? "Try a different keyword or category."
          : "Be one of the first creators to list a product built on Kimble."}
      </p>
      {!hasListings && (
        <Button asChild className="mt-6">
          <Link to="/sell">List your first product</Link>
        </Button>
      )}
    </div>
  );
}
