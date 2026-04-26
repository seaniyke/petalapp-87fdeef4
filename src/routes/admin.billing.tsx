import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Save } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchCurrencies,
  fetchPlans,
  fetchCreditPacks,
  fetchPriceOverrides,
  type BillingCurrency,
  type Plan,
  type CreditPack,
  type PriceOverride,
} from "@/lib/billing";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/billing")({
  head: () => ({
    meta: [
      { title: "Admin · Billing settings" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminBillingPage,
});

function AdminBillingPage() {
  const { user, isReady } = useAuth();
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      navigate({ to: "/auth", search: { mode: "signin", redirect: "/admin/billing" } });
      return;
    }
    if (!adminLoading && !isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [isReady, user, adminLoading, isAdmin, navigate]);

  if (!isReady || adminLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Billing settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage exchange rates and per-currency price overrides for plans and credit packs.
            </p>
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
        </div>

        <Tabs defaultValue="currencies" className="space-y-6">
          <TabsList>
            <TabsTrigger value="currencies">Currencies & rates</TabsTrigger>
            <TabsTrigger value="overrides">Price overrides</TabsTrigger>
          </TabsList>
          <TabsContent value="currencies">
            <CurrenciesPanel />
          </TabsContent>
          <TabsContent value="overrides">
            <OverridesPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* ------------------------------- Currencies ------------------------------- */

function CurrenciesPanel() {
  const [rows, setRows] = useState<BillingCurrency[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // Admin needs to see inactive too — bypass the helper's is_active filter.
      const { data, error } = await supabase
        .from("billing_currencies")
        .select("code, name, symbol, usd_rate, is_active, paystack_supported, sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setRows((data ?? []).map((c) => ({ ...c, usd_rate: Number(c.usd_rate) })) as BillingCurrency[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load currencies");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(code: string, patch: Partial<BillingCurrency>) {
    setRows((prev) => prev.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  }

  async function save(row: BillingCurrency) {
    setSavingCode(row.code);
    try {
      const { error } = await supabase
        .from("billing_currencies")
        .update({
          name: row.name,
          symbol: row.symbol,
          usd_rate: row.usd_rate,
          is_active: row.is_active,
          paystack_supported: row.paystack_supported,
          sort_order: row.sort_order,
        })
        .eq("code", row.code);
      if (error) throw error;
      toast.success(`${row.code} saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currencies & exchange rates</CardTitle>
        <CardDescription>
          USD is the base currency. <code>usd_rate</code> is how many units of the local currency 1
          USD buys. Example: NGN rate of 1600 means $1 = ₦1,600.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>USD rate</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Paystack</TableHead>
                <TableHead>Sort</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.code}>
                  <TableCell className="font-mono text-sm font-medium">{r.code}</TableCell>
                  <TableCell>
                    <Input value={r.name} onChange={(e) => update(r.code, { name: e.target.value })} />
                  </TableCell>
                  <TableCell className="w-24">
                    <Input
                      value={r.symbol}
                      onChange={(e) => update(r.code, { symbol: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="w-36">
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={r.usd_rate}
                      onChange={(e) =>
                        update(r.code, { usd_rate: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.is_active}
                      onCheckedChange={(v) => update(r.code, { is_active: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.paystack_supported}
                      onCheckedChange={(v) => update(r.code, { paystack_supported: v })}
                    />
                  </TableCell>
                  <TableCell className="w-20">
                    <Input
                      type="number"
                      value={r.sort_order}
                      onChange={(e) =>
                        update(r.code, { sort_order: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() => save(r)}
                      disabled={savingCode === r.code}
                    >
                      {savingCode === r.code ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Save className="mr-1.5 h-3.5 w-3.5" /> Save
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- Overrides -------------------------------- */

const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  NGN: 2,
  GHS: 2,
  KES: 2,
  ZAR: 2,
};

function OverridesPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [loading, setLoading] = useState(true);

  // New override form
  const [newKind, setNewKind] = useState<"plan" | "pack">("plan");
  const [newItem, setNewItem] = useState<string>("");
  const [newCurrency, setNewCurrency] = useState<string>("");
  const [newAmountMajor, setNewAmountMajor] = useState<string>("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, c, cur, ovs] = await Promise.all([
        fetchPlans(),
        fetchCreditPacks(),
        fetchCurrencies(),
        fetchPriceOverrides(),
      ]);
      setPlans(p);
      setPacks(c);
      setCurrencies(cur);
      setOverrides(ovs);
      if (!newItem && p.length > 0) setNewItem(p[0].code);
      if (!newCurrency && cur.length > 0) setNewCurrency(cur[0].code);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When kind changes, reset selected item to the first available.
  useEffect(() => {
    if (newKind === "plan" && plans.length > 0) setNewItem(plans[0].code);
    if (newKind === "pack" && packs.length > 0) setNewItem(packs[0].code);
  }, [newKind, plans, packs]);

  const itemOptions = useMemo(
    () => (newKind === "plan" ? plans.map((p) => ({ code: p.code, name: p.name })) : packs.map((p) => ({ code: p.code, name: p.name }))),
    [newKind, plans, packs],
  );

  async function addOverride() {
    const cur = newCurrency.toUpperCase();
    const decimals = CURRENCY_DECIMALS[cur] ?? 2;
    const major = parseFloat(newAmountMajor);
    if (!Number.isFinite(major) || major <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    const amountMinor = Math.round(major * Math.pow(10, decimals));
    setAdding(true);
    try {
      const { error } = await supabase
        .from("billing_price_overrides")
        .upsert(
          {
            item_kind: newKind,
            item_code: newItem,
            currency_code: cur,
            amount_minor: amountMinor,
          },
          { onConflict: "item_kind,item_code,currency_code" },
        );
      if (error) throw error;
      toast.success("Override saved");
      setNewAmountMajor("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAdding(false);
    }
  }

  async function deleteOverride(o: PriceOverride) {
    if (!confirm(`Delete ${o.item_kind} ${o.item_code} override for ${o.currency_code}?`)) return;
    try {
      const { error } = await supabase
        .from("billing_price_overrides")
        .delete()
        .eq("item_kind", o.item_kind)
        .eq("item_code", o.item_code)
        .eq("currency_code", o.currency_code);
      if (error) throw error;
      toast.success("Override removed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function nameFor(kind: "plan" | "pack", code: string): string {
    if (kind === "plan") return plans.find((p) => p.code === code)?.name ?? code;
    return packs.find((p) => p.code === code)?.name ?? code;
  }

  function usdPriceFor(kind: "plan" | "pack", code: string): string {
    const cents = kind === "plan"
      ? plans.find((p) => p.code === code)?.price_cents
      : packs.find((p) => p.code === code)?.price_cents;
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add or update price override</CardTitle>
          <CardDescription>
            Overrides take precedence over the rate-based conversion. Enter the price in the local
            currency's major unit (e.g. 24000 for ₦24,000).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={newKind} onValueChange={(v) => setNewKind(v as "plan" | "pack")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan">Plan</SelectItem>
                  <SelectItem value="pack">Credit pack</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Item</Label>
              <Select value={newItem} onValueChange={setNewItem}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {itemOptions.map((o) => (
                    <SelectItem key={o.code} value={o.code}>
                      {o.name} ({o.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={newCurrency} onValueChange={setNewCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 24000"
                value={newAmountMajor}
                onChange={(e) => setNewAmountMajor(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addOverride} disabled={adding || !newItem || !newCurrency} className="w-full">
                {adding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="mr-1.5 h-4 w-4" /> Save override
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing overrides</CardTitle>
          <CardDescription>
            When an override exists for an item + currency pair, it is used instead of the
            exchange-rate calculation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : overrides.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No overrides yet. All prices are computed from the USD rate.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>USD price</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Override (minor)</TableHead>
                  <TableHead>Override (display)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((o) => {
                  const cur = currencies.find((c) => c.code === o.currency_code);
                  const decimals = CURRENCY_DECIMALS[o.currency_code] ?? 2;
                  const major = (o.amount_minor / Math.pow(10, decimals)).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });
                  return (
                    <TableRow key={`${o.item_kind}:${o.item_code}:${o.currency_code}`}>
                      <TableCell className="capitalize">{o.item_kind}</TableCell>
                      <TableCell>
                        <div className="font-medium">{nameFor(o.item_kind, o.item_code)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{o.item_code}</div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {usdPriceFor(o.item_kind, o.item_code)}
                      </TableCell>
                      <TableCell className="font-mono">{o.currency_code}</TableCell>
                      <TableCell className="font-mono text-xs">{o.amount_minor.toLocaleString()}</TableCell>
                      <TableCell>
                        {cur?.symbol ?? ""}{major}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteOverride(o)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
