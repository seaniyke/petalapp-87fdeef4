import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Users, Search, Coins } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Admin · Users & roles" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminUsersPage,
});

type WalletInfo = {
  user_id: string;
  plan_code: string | null;
  monthly_credits_remaining: number | null;
  topup_credits_remaining: number | null;
} | null;

type UserRow = {
  id: string;
  email: string | null;
  wallet: WalletInfo;
};

async function callApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/admin/credits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function AdminUsersPage() {
  const { ready } = useAdminGuard("/admin/users");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [granting, setGranting] = useState(false);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 2) {
      toast.error("Type at least 2 characters");
      return;
    }
    setSearching(true);
    try {
      const { users: results } = await callApi<{ users: UserRow[] }>({
        action: "lookup",
        query: query.trim(),
      });
      setUsers(results);
      if (!results.length) toast.message("No users found");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error("Enter a non-zero amount");
      return;
    }
    setGranting(true);
    try {
      const { wallet } = await callApi<{ wallet: WalletInfo }>({
        action: "grant",
        target_user_id: selected.id,
        amount: amt,
        note: note.trim() || undefined,
      });
      toast.success(
        `${amt > 0 ? "Granted" : "Deducted"} ${Math.abs(amt)} credits`,
      );
      setSelected({ ...selected, wallet });
      setUsers((prev) =>
        prev.map((u) => (u.id === selected.id ? { ...u, wallet } : u)),
      );
      setAmount("");
      setNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setGranting(false);
    }
  }

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
              Users & credits
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Search by email or user id, then grant or deduct credits.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>

        <Card className="mb-6 border-border/60">
          <CardContent className="p-5">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Email or user id…"
                  className="pl-9"
                />
              </div>
              <Button type="submit" disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {users.length > 0 && (
          <Card className="mb-6 border-border/60">
            <CardContent className="p-0">
              <ul className="divide-y divide-border/60">
                {users.map((u) => {
                  const isSel = selected?.id === u.id;
                  const topup = Number(u.wallet?.topup_credits_remaining ?? 0);
                  const monthly = Number(u.wallet?.monthly_credits_remaining ?? 0);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(u)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/40 ${
                          isSel ? "bg-muted/60" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {u.email ?? "(no email)"}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {u.id}
                          </div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>
                            <span className="font-medium text-foreground">{topup}</span> top-up
                          </div>
                          <div>{monthly} monthly · {u.wallet?.plan_code ?? "free"}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {selected && (
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                <h2 className="text-base font-medium">
                  Adjust credits for {selected.email ?? selected.id}
                </h2>
              </div>
              <form onSubmit={handleGrant} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Amount (use negative to deduct)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 50 or -10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Note (optional)
                  </label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why are you adjusting this balance?"
                    rows={2}
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={granting}>
                    {granting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      "Apply adjustment"
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {users.length === 0 && !selected && (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
            <Users className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Search for a user above to grant or deduct credits.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
