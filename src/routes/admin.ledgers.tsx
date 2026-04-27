import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Receipt } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";

export const Route = createFileRoute("/admin/ledgers")({
  head: () => ({
    meta: [
      { title: "Admin · Ledgers & transactions" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLedgersPage,
});

function AdminLedgersPage() {
  const { ready } = useAdminGuard("/admin/ledgers");

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Ledgers & transactions
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Recent credit ledger entries and Paystack transactions.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>

        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <Receipt className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <h2 className="text-base font-medium">Coming soon</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Filterable ledger and transaction views with CSV export.
          </p>
        </div>
      </main>
    </div>
  );
}
