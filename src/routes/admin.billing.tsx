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
              Manage subscription plans, credit packs, exchange rates, and per-currency price overrides.
            </p>
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
        </div>

        <Tabs defaultValue="plans" className="space-y-6">
          <TabsList>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="packs">Credit packs</TabsTrigger>
            <TabsTrigger value="addons">Add-ons</TabsTrigger>
            <TabsTrigger value="currencies">Currencies & rates</TabsTrigger>
            <TabsTrigger value="overrides">Price overrides</TabsTrigger>
          </TabsList>
          <TabsContent value="plans">
            <PlansPanel />
          </TabsContent>
          <TabsContent value="packs">
            <CreditPacksPanel />
          </TabsContent>
          <TabsContent value="addons">
            <AddonsPanel />
          </TabsContent>
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
  const [addons, setAddons] = useState<Array<{ code: string; name: string; price_cents: number }>>([]);
  const [currencies, setCurrencies] = useState<BillingCurrency[]>([]);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [loading, setLoading] = useState(true);

  // New override form
  const [newKind, setNewKind] = useState<"plan" | "pack" | "addon">("plan");
  const [newItem, setNewItem] = useState<string>("");
  const [newCurrency, setNewCurrency] = useState<string>("");
  const [newAmountMajor, setNewAmountMajor] = useState<string>("");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, c, cur, ovs, addonRes] = await Promise.all([
        fetchPlans(),
        fetchCreditPacks(),
        fetchCurrencies(),
        fetchPriceOverrides(),
        supabase
          .from("billing_addons")
          .select("code, name, price_cents")
          .order("sort_order", { ascending: true }),
      ]);
      setPlans(p);
      setPacks(c);
      setCurrencies(cur);
      setOverrides(ovs);
      setAddons((addonRes.data ?? []) as Array<{ code: string; name: string; price_cents: number }>);
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
    if (newKind === "addon" && addons.length > 0) setNewItem(addons[0].code);
  }, [newKind, plans, packs, addons]);

  const itemOptions = useMemo(
    () =>
      newKind === "plan"
        ? plans.map((p) => ({ code: p.code, name: p.name }))
        : newKind === "pack"
          ? packs.map((p) => ({ code: p.code, name: p.name }))
          : addons.map((p) => ({ code: p.code, name: p.name })),
    [newKind, plans, packs, addons],
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

  function nameFor(kind: "plan" | "pack" | "addon", code: string): string {
    if (kind === "plan") return plans.find((p) => p.code === code)?.name ?? code;
    if (kind === "pack") return packs.find((p) => p.code === code)?.name ?? code;
    return code;
  }

  function usdPriceFor(kind: "plan" | "pack" | "addon", code: string): string {
    if (kind === "addon") return "—";
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

/* --------------------------------- Plans ---------------------------------- */

type PlanRow = {
  code: string;
  name: string;
  tier: string;
  monthly_credits: number;
  daily_free_credits: number;
  monthly_free_cap: number | null;
  price_cents: number;
  stripe_price_id: string | null;
  is_active: boolean;
  sort_order: number;
};

function PlansPanel() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<PlanRow>(emptyPlan());

  function emptyPlanLocal(): PlanRow { return emptyPlan(); }

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("billing_plans")
        .select(
          "code, name, tier, monthly_credits, daily_free_credits, monthly_free_cap, price_cents, stripe_price_id, is_active, sort_order"
        )
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setRows((data ?? []) as PlanRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(code: string, patch: Partial<PlanRow>) {
    setRows((prev) => prev.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  }

  async function save(row: PlanRow) {
    setSavingCode(row.code);
    try {
      const { error } = await supabase
        .from("billing_plans")
        .update({
          name: row.name,
          tier: row.tier,
          monthly_credits: row.monthly_credits,
          daily_free_credits: row.daily_free_credits,
          monthly_free_cap: row.monthly_free_cap,
          price_cents: row.price_cents,
          stripe_price_id: row.stripe_price_id || null,
          is_active: row.is_active,
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

  async function remove(row: PlanRow) {
    if (!confirm(`Delete plan "${row.code}"? This cannot be undone.`)) return;
    setDeletingCode(row.code);
    try {
      const { error } = await supabase.from("billing_plans").delete().eq("code", row.code);
      if (error) throw error;
      toast.success(`${row.code} deleted`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingCode(null);
    }
  }

  async function create() {
    if (!draft.code.trim() || !draft.name.trim()) {
      toast.error("Code and name are required");
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from("billing_plans").insert({
        code: draft.code.trim(),
        name: draft.name.trim(),
        tier: draft.tier || draft.code.trim(),
        monthly_credits: draft.monthly_credits,
        daily_free_credits: draft.daily_free_credits,
        monthly_free_cap: draft.monthly_free_cap,
        price_cents: draft.price_cents,
        stripe_price_id: draft.stripe_price_id || null,
        is_active: draft.is_active,
        sort_order: draft.sort_order,
        features: {},
      });
      if (error) throw error;
      toast.success("Plan created");
      setDraft(emptyPlanLocal());
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>
            Subscription plan tiers and their base USD price. Per-currency prices are derived from
            the USD rate or a price override.
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
                  <TableHead>Tier</TableHead>
                  <TableHead>Monthly credits</TableHead>
                  <TableHead>Daily free</TableHead>
                  <TableHead>Monthly free cap</TableHead>
                  <TableHead>Price (USD)</TableHead>
                  <TableHead>Stripe price ID</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell className="font-mono text-sm font-medium">{r.code}</TableCell>
                    <TableCell><Input value={r.name} onChange={(e) => update(r.code, { name: e.target.value })} /></TableCell>
                    <TableCell className="w-28">
                      <Input value={r.tier} onChange={(e) => update(r.code, { tier: e.target.value })} />
                    </TableCell>
                    <TableCell className="w-32">
                      <Input
                        type="number" min="0"
                        value={r.monthly_credits}
                        onChange={(e) => update(r.code, { monthly_credits: parseInt(e.target.value, 10) || 0 })}
                      />
                    </TableCell>
                    <TableCell className="w-28">
                      <Input
                        type="number" min="0"
                        value={r.daily_free_credits}
                        onChange={(e) => update(r.code, { daily_free_credits: parseInt(e.target.value, 10) || 0 })}
                      />
                    </TableCell>
                    <TableCell className="w-32">
                      <Input
                        type="number" min="0"
                        placeholder="∞"
                        value={r.monthly_free_cap ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          update(r.code, { monthly_free_cap: v === "" ? null : parseInt(v, 10) || 0 });
                        }}
                      />
                    </TableCell>
                    <TableCell className="w-32">
                      <Input
                        type="number" step="0.01" min="0"
                        value={(r.price_cents / 100).toFixed(2)}
                        onChange={(e) => update(r.code, { price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                      />
                    </TableCell>
                    <TableCell className="w-44">
                      <Input
                        value={r.stripe_price_id ?? ""}
                        onChange={(e) => update(r.code, { stripe_price_id: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch checked={r.is_active} onCheckedChange={(v) => update(r.code, { is_active: v })} />
                    </TableCell>
                    <TableCell className="w-20">
                      <Input
                        type="number"
                        value={r.sort_order}
                        onChange={(e) => update(r.code, { sort_order: parseInt(e.target.value, 10) || 0 })}
                      />
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" onClick={() => save(r)} disabled={savingCode === r.code}>
                        {savingCode === r.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="mr-1.5 h-3.5 w-3.5" /> Save</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r)} disabled={deletingCode === r.code} className="text-destructive hover:text-destructive">
                        {deletingCode === r.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a new plan</CardTitle>
          <CardDescription>Code is unique and used internally. USD price is in dollars.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="e.g. team" />
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Team" />
            </div>
            <div className="space-y-1.5">
              <Label>Tier</Label>
              <Input value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })} placeholder="e.g. business" />
            </div>
            <div className="space-y-1.5">
              <Label>Price (USD)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={(draft.price_cents / 100).toString()}
                onChange={(e) => setDraft({ ...draft, price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Monthly credits</Label>
              <Input
                type="number" min="0"
                value={draft.monthly_credits}
                onChange={(e) => setDraft({ ...draft, monthly_credits: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Daily free</Label>
              <Input
                type="number" min="0"
                value={draft.daily_free_credits}
                onChange={(e) => setDraft({ ...draft, daily_free_credits: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Monthly free cap</Label>
              <Input
                type="number" min="0"
                placeholder="leave empty for ∞"
                value={draft.monthly_free_cap ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft({ ...draft, monthly_free_cap: v === "" ? null : parseInt(v, 10) || 0 });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="md:col-span-4">
              <Button onClick={create} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1.5 h-4 w-4" /> Create plan</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function emptyPlan(): PlanRow {
  return {
    code: "",
    name: "",
    tier: "",
    monthly_credits: 0,
    daily_free_credits: 0,
    monthly_free_cap: null,
    price_cents: 0,
    stripe_price_id: null,
    is_active: true,
    sort_order: 0,
  };
}

/* ----------------------------- Credit packs ------------------------------- */

type CreditPackRow = {
  code: string;
  name: string;
  credits: number;
  price_cents: number;
  stripe_price_id: string | null;
  is_active: boolean;
  sort_order: number;
};

function CreditPacksPanel() {
  const [rows, setRows] = useState<CreditPackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreditPackRow>(emptyPack());

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("credit_packs")
        .select("code, name, credits, price_cents, stripe_price_id, is_active, sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      setRows((data ?? []).map((p) => ({ ...p, credits: Number(p.credits) })) as CreditPackRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load credit packs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(code: string, patch: Partial<CreditPackRow>) {
    setRows((prev) => prev.map((r) => (r.code === code ? { ...r, ...patch } : r)));
  }

  async function save(row: CreditPackRow) {
    setSavingCode(row.code);
    try {
      const { error } = await supabase
        .from("credit_packs")
        .update({
          name: row.name,
          credits: row.credits,
          price_cents: row.price_cents,
          stripe_price_id: row.stripe_price_id || null,
          is_active: row.is_active,
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

  async function remove(row: CreditPackRow) {
    if (!confirm(`Delete credit pack "${row.code}"? This cannot be undone.`)) return;
    setDeletingCode(row.code);
    try {
      const { error } = await supabase.from("credit_packs").delete().eq("code", row.code);
      if (error) throw error;
      toast.success(`${row.code} deleted`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingCode(null);
    }
  }

  async function create() {
    if (!draft.code.trim() || !draft.name.trim()) {
      toast.error("Code and name are required");
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from("credit_packs").insert({
        code: draft.code.trim(),
        name: draft.name.trim(),
        credits: draft.credits,
        price_cents: draft.price_cents,
        stripe_price_id: draft.stripe_price_id || null,
        is_active: draft.is_active,
        sort_order: draft.sort_order,
      });
      if (error) throw error;
      toast.success("Credit pack created");
      setDraft(emptyPack());
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Credit packs</CardTitle>
          <CardDescription>
            One-time credit purchases. USD price is the base; per-currency prices follow rates and overrides.
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
                  <TableHead>Credits</TableHead>
                  <TableHead>Price (USD)</TableHead>
                  <TableHead>Stripe price ID</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.code}>
                    <TableCell className="font-mono text-sm font-medium">{r.code}</TableCell>
                    <TableCell><Input value={r.name} onChange={(e) => update(r.code, { name: e.target.value })} /></TableCell>
                    <TableCell className="w-32">
                      <Input
                        type="number" min="0"
                        value={r.credits}
                        onChange={(e) => update(r.code, { credits: parseInt(e.target.value, 10) || 0 })}
                      />
                    </TableCell>
                    <TableCell className="w-32">
                      <Input
                        type="number" step="0.01" min="0"
                        value={(r.price_cents / 100).toFixed(2)}
                        onChange={(e) => update(r.code, { price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                      />
                    </TableCell>
                    <TableCell className="w-44">
                      <Input
                        value={r.stripe_price_id ?? ""}
                        onChange={(e) => update(r.code, { stripe_price_id: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch checked={r.is_active} onCheckedChange={(v) => update(r.code, { is_active: v })} />
                    </TableCell>
                    <TableCell className="w-20">
                      <Input
                        type="number"
                        value={r.sort_order}
                        onChange={(e) => update(r.code, { sort_order: parseInt(e.target.value, 10) || 0 })}
                      />
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" onClick={() => save(r)} disabled={savingCode === r.code}>
                        {savingCode === r.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="mr-1.5 h-3.5 w-3.5" /> Save</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r)} disabled={deletingCode === r.code} className="text-destructive hover:text-destructive">
                        {deletingCode === r.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a new credit pack</CardTitle>
          <CardDescription>Code is unique. Credits is the number of build credits granted.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="e.g. pack_500" />
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. 500 credits" />
            </div>
            <div className="space-y-1.5">
              <Label>Credits</Label>
              <Input
                type="number" min="0"
                value={draft.credits}
                onChange={(e) => setDraft({ ...draft, credits: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Price (USD)</Label>
              <Input
                type="number" step="0.01" min="0"
                value={(draft.price_cents / 100).toString()}
                onChange={(e) => setDraft({ ...draft, price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="md:col-span-4">
              <Button onClick={create} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1.5 h-4 w-4" /> Create credit pack</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function emptyPack(): CreditPackRow {
  return {
    code: "",
    name: "",
    credits: 0,
    price_cents: 0,
    stripe_price_id: null,
    is_active: true,
    sort_order: 0,
  };
}
