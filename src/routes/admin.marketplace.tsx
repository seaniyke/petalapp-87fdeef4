import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { AdminMarketplaceEconomy } from "@/components/marketplace/AdminMarketplaceEconomy";
import {
  decideListing,
  formatListingPrice,
  listListingsForReview,
  type ListingRow,
} from "@/lib/marketplace";

export const Route = createFileRoute("/admin/marketplace")({
  head: () => ({
    meta: [
      { title: "Admin · Marketplace" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminMarketplacePage,
});

function AdminMarketplacePage() {
  const { ready } = useAdminGuard("/admin/marketplace");
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listListingsForReview());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load listings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function decide(id: string, decision: "live" | "rejected" | "delisted") {
    setBusyId(id);
    try {
      await decideListing(id, decision, notes[id]?.trim() || undefined);
      toast.success(
        decision === "live" ? "Listing is live" : decision === "rejected" ? "Sent back to creator" : "Delisted",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update listing");
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) return null;

  const pending = rows.filter((r) => r.status === "in_review");
  const others = rows.filter((r) => r.status !== "in_review");

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Marketplace review</h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Approve what goes live in the marketplace.
        </p>

        {loading ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <Section title={`Awaiting review (${pending.length})`}>
              {pending.length === 0 ? (
                <EmptyRow label="Nothing waiting on you." />
              ) : (
                pending.map((r) => (
                  <ListingRowCard
                    key={r.id}
                    row={r}
                    busy={busyId === r.id}
                    note={notes[r.id] ?? ""}
                    onNote={(v) => setNotes((n) => ({ ...n, [r.id]: v }))}
                    onDecide={decide}
                  />
                ))
              )}
            </Section>

            <Section title={`Everything else (${others.length})`}>
              {others.length === 0 ? (
                <EmptyRow label="No listings yet." />
              ) : (
                others.map((r) => (
                  <ListingRowCard
                    key={r.id}
                    row={r}
                    busy={busyId === r.id}
                    note={notes[r.id] ?? ""}
                    onNote={(v) => setNotes((n) => ({ ...n, [r.id]: v }))}
                    onDecide={decide}
                  />
                ))
              )}
            </Section>
            <AdminMarketplaceEconomy />
          </>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm font-medium text-muted-foreground">
      <Store className="mx-auto mb-2 h-6 w-6" aria-hidden />
      {label}
    </div>
  );
}

function ListingRowCard({
  row,
  busy,
  note,
  onNote,
  onDecide,
}: {
  row: ListingRow;
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onDecide: (id: string, decision: "live" | "rejected" | "delisted") => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{row.title}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase text-muted-foreground">
              {row.status.replace("_", " ")}
            </span>
            <span className="text-xs font-semibold text-muted-foreground">
              {formatListingPrice(Number(row.price_minor), row.currency_code)} · {row.file_count} files
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground">{row.pitch}</p>
          <p className="mt-1 text-[11px] font-medium text-muted-foreground">
            /{row.slug} · {row.category} · {row.license_code}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-96">
          <Input
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="Note to creator (optional)"
            aria-label={`Review note for ${row.title}`}
          />
          <div className="flex flex-wrap gap-2">
            {row.status !== "live" && (
              <Button size="sm" disabled={busy} onClick={() => onDecide(row.id, "live")}>
                Approve
              </Button>
            )}
            {row.status === "in_review" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDecide(row.id, "rejected")}
              >
                Request changes
              </Button>
            )}
            {row.status === "live" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDecide(row.id, "delisted")}
              >
                Delist
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
