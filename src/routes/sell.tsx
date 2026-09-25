import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { PetalLoader } from "@/components/PetalLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { listProjects, type ProjectRow } from "@/lib/projects";
import { CreatorEarningsPanel } from "@/components/marketplace/CreatorEarningsPanel";
import { useMarketplaceFeature } from "@/hooks/use-marketplace-feature";
import {
  createListingFromProject,
  deleteListing,
  formatListingPrice,
  listLicenses,
  listMyListings,
  listMySales,
  refreshListingSnapshot,
  submitListingForReview,
  updateListing,
  type LicenseRow,
  type ListingRow,
  LISTING_CATEGORIES,
} from "@/lib/marketplace";

export const Route = createFileRoute("/sell")({
  head: () => ({
    meta: [
      { title: "Sell your app · Kimble Marketplace" },
      {
        name: "description",
        content:
          "Turn a project you built on Kimble into a product other people can buy, open and customize.",
      },
      { property: "og:title", content: "Sell your app on Kimble" },
      {
        property: "og:description",
        content: "List a Kimble project as a product in the marketplace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SellRoute,
});

function SellRoute() {
  const { enabled, loading } = useMarketplaceFeature();
  if (loading) {
    return <div className="min-h-screen bg-background"><SiteHeader /><div className="grid place-items-center py-32"><PetalLoader size={56} label="Loading…" /></div></div>;
  }
  if (!enabled) {
    return <div className="min-h-screen bg-background"><SiteHeader /><div className="mx-auto max-w-xl px-6 py-32 text-center"><h1 className="text-2xl font-bold">This page isn't available</h1><Button asChild className="mt-6"><Link to="/">Back to Kimble</Link></Button></div></div>;
  }
  return <SellPage />;
}

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  in_review: { label: "In review", className: "bg-amber-500/15 text-amber-600" },
  live: { label: "Live", className: "bg-emerald-500/15 text-emerald-600" },
  rejected: { label: "Changes needed", className: "bg-destructive/15 text-destructive" },
  delisted: { label: "Delisted", className: "bg-muted text-muted-foreground" },
};

function SellPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("app");
  const [licenseCode, setLicenseCode] = useState("personal");
  const [demoUrl, setDemoUrl] = useState("");
  const [price, setPrice] = useState("0");
  const [sales, setSales] = useState<
    Awaited<ReturnType<typeof listMySales>>
  >([]);

  const load = useCallback(async () => {
    const [mine, mineProjects, lics, mySales] = await Promise.all([
      listMyListings(),
      listProjects(),
      listLicenses(),
      listMySales(),
    ]);
    setListings(mine);
    setSales(mySales);
    setProjects(mineProjects);
    setLicenses(lics);
    if (lics[0]) setLicenseCode((c) => c || lics[0]!.code);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        navigate({ to: "/auth", search: { mode: "signin", redirect: "/sell" } as never });
        return;
      }
      try {
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load your listings");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, navigate]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) {
      toast.error("Pick which project you're listing");
      return;
    }
    setCreating(true);
    try {
      await createListingFromProject({
        projectId,
        title: title.trim(),
        pitch: pitch.trim(),
        description: description.trim(),
        category,
        licenseCode,
        priceMinor: Math.max(0, Math.round(Number(price || "0") * 100)),
        demoUrl: demoUrl.trim() || null,
      });
      toast.success("Draft created — submit it for review when you're ready");
      setTitle("");
      setPitch("");
      setDescription("");
      setDemoUrl("");
      setPrice("0");
      setProjectId("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the listing");
    } finally {
      setCreating(false);
    }
  }

  async function withBusy(id: string, fn: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try {
      await fn();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="grid place-items-center py-32">
          <PetalLoader size={56} label="Loading your listings…" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Creator studio
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Sell your app</h1>
          <p className="mt-3 max-w-xl text-sm font-medium text-muted-foreground">
            Pick a project you've built, describe it, and choose a license. We freeze a copy
            of its files so buyers get exactly what you listed — you keep building on the
            original.
          </p>
        </header>

        <section className="mt-10 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-bold">New listing</h2>
          <form className="mt-5 grid gap-5" onSubmit={handleCreate}>
            <div className="grid gap-2">
              <Label htmlFor="listing-project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="listing-project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title || "Untitled project"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="listing-title">Product name</Label>
              <Input
                id="listing-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Invoice Studio"
                required
                maxLength={80}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="listing-pitch">One-line pitch</Label>
              <Input
                id="listing-pitch"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                placeholder="Send branded invoices and get paid in a click."
                required
                maxLength={160}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="listing-description">What's included</Label>
              <Textarea
                id="listing-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Pages, features, integrations and anything a buyer should know."
                rows={5}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="listing-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="listing-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTING_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">
                        {c.replace("-", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="listing-license">License</Label>
                <Select value={licenseCode} onValueChange={setLicenseCode}>
                  <SelectTrigger id="listing-license">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {licenses.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="listing-demo">Live demo URL (optional)</Label>
              <Input
                id="listing-demo"
                value={demoUrl}
                onChange={(e) => setDemoUrl(e.target.value)}
                placeholder="https://…"
                type="url"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="listing-price">Price (USD)</Label>
              <Input
                id="listing-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min={0}
                step="1"
                inputMode="decimal"
              />
              <p className="text-xs font-medium text-muted-foreground">
                Set 0 to give it away free. Kimble keeps 20% of each sale; the rest is yours.
              </p>
            </div>

            <div>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" /> Create draft
                  </>
                )}
              </Button>
            </div>
          </form>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-bold">Your listings</h2>
          {listings.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border py-14 text-center">
              <Store className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                Nothing listed yet. Your first product starts above.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {listings.map((l) => {
                const status = STATUS_COPY[l.status] ?? STATUS_COPY['draft']!;
                const busy = busyId === l.id;
                return (
                  <li
                    key={l.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">{l.title}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs font-medium text-muted-foreground">
                        {l.pitch || "No pitch yet"} · {l.file_count} files ·{" "}
                        {formatListingPrice(Number(l.price_minor), l.currency_code)}
                      </p>
                      {l.review_note && (
                        <p className="mt-1 text-xs font-medium text-destructive">{l.review_note}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {l.status === "live" && (
                        <Button asChild variant="outline" size="sm">
                          <Link to="/marketplace/$slug" params={{ slug: l.slug }}>
                            View
                          </Link>
                        </Button>
                      )}
                      {l.project_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            withBusy(
                              l.id,
                              () => refreshListingSnapshot(l.id, l.project_id!),
                              "Snapshot updated",
                            )
                          }
                        >
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-snapshot
                        </Button>
                      )}
                      {(l.status === "draft" || l.status === "rejected") && (
                        <Input
                          className="h-8 w-24"
                          type="number"
                          min={0}
                          step="1"
                          defaultValue={(Number(l.price_minor) / 100).toString()}
                          aria-label={`Price for ${l.title} in USD`}
                          onBlur={(e) => {
                            const next = Math.max(0, Math.round(Number(e.target.value || "0") * 100));
                            if (next === Number(l.price_minor)) return;
                            void withBusy(
                              l.id,
                              () => updateListing(l.id, { price_minor: next }),
                              "Price updated",
                            );
                          }}
                        />
                      )}
                      {(l.status === "draft" || l.status === "rejected") && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            withBusy(l.id, () => submitListingForReview(l.id), "Sent for review")
                          }
                        >
                          Submit for review
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`Delete ${l.title}`}
                        onClick={() => withBusy(l.id, () => deleteListing(l.id), "Listing deleted")}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="mt-12">
          <h2 className="text-lg font-bold">Earnings</h2>
          <CreatorEarningsPanel />
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-bold">Sales</h2>
          {sales.length === 0 ? (
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              No sales yet. Once a product goes live, every purchase shows up here with your
              earnings.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm font-bold">
                {sales.length} sale{sales.length === 1 ? "" : "s"} ·{" "}
                {formatListingPrice(
                  sales.reduce((sum, s2) => sum + Number(s2.creator_net_cents), 0),
                  "USD",
                )}{" "}
                earned
              </p>
              <ul className="mt-4 space-y-2">
                {sales.map((s2) => (
                  <li
                    key={s2.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{s2.listing_title}</p>
                      <p className="text-xs font-medium text-muted-foreground">
                        {new Date(s2.created_at).toLocaleDateString()} · {s2.source}
                      </p>
                    </div>
                    <p className="text-sm font-bold tabular-nums">
                      {formatListingPrice(Number(s2.creator_net_cents), "USD")}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
