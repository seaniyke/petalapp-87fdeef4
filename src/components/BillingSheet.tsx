/**
 * Billing sheet — pricing + top-ups + manage-subscription portal link.
 *
 * Three views toggled by local state:
 *  - "menu":    plan cards + pack cards + manage button
 *  - "checkout": Stripe embedded form (after the user picks a price)
 *  - "success": post-checkout confirmation
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useWallet } from "@/hooks/use-wallet";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import { fetchCreditPacks, type CreditPack } from "@/lib/billing";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type View =
  | { kind: "menu" }
  | { kind: "checkout"; priceId: string; label: string }
  | { kind: "success"; sessionId: string | null };

export function BillingSheet({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { wallet, plans, plan, refresh } = useWallet();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [view, setView] = useState<View>({ kind: "menu" });
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchCreditPacks().then(setPacks).catch((e: unknown) => {
      console.warn("[BillingSheet] fetchCreditPacks failed", e);
    });
  }, [open]);

  // Reset to menu when the sheet closes.
  useEffect(() => {
    if (!open) setView({ kind: "menu" });
  }, [open]);

  // Refresh wallet when we land on success (webhook may take a beat).
  useEffect(() => {
    if (view.kind !== "success") return;
    const t1 = setTimeout(() => refresh(), 1500);
    const t2 = setTimeout(() => refresh(), 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [view, refresh]);

  const paid = useMemo(() => plans.filter((p) => p.code !== "free"), [plans]);
  const currentPlanCode = wallet?.plan_code ?? "free";

  function startCheckout(priceId: string, label: string) {
    setView({ kind: "checkout", priceId, label });
  }

  async function openPortal() {
    if (!user) return;
    setPortalLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const res = await fetch("/api/billing/create-portal-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          environment: getStripeEnvironment(),
          returnUrl: window.location.href,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Could not open billing portal");
      }
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error("No portal URL");
      window.open(json.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open portal");
    } finally {
      setPortalLoading(false);
    }
  }

  const returnUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {view.kind === "checkout" ? view.label : "Plans & credits"}
          </SheetTitle>
          {view.kind === "menu" && (
            <SheetDescription>
              Each AI message costs 1 credit. Upgrade for more monthly credits or top up anytime.
            </SheetDescription>
          )}
        </SheetHeader>

        {!isPaymentsConfigured() && (
          <div className="mt-6 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            Payments are not configured. Set <code>VITE_PAYMENTS_CLIENT_TOKEN</code> to enable checkout.
          </div>
        )}

        {view.kind === "menu" && (
          <div className="mt-6 space-y-6">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Subscriptions</h3>
                {plan && (
                  <Badge variant="secondary">Current: {plan.name}</Badge>
                )}
              </div>
              <div className="grid gap-3">
                {paid.map((p) => {
                  const isCurrent = p.code === currentPlanCode;
                  return (
                    <div
                      key={p.code}
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.monthly_credits.toLocaleString()} credits / month
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold tabular-nums">
                            ${(p.price_cents / 100).toFixed(0)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">/ month</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isCurrent ? "secondary" : "default"}
                        disabled={isCurrent || !user}
                        className="mt-3 w-full"
                        onClick={() =>
                          startCheckout(`${p.code === "pro" ? "plan_pro_monthly" : "plan_business_monthly"}`, p.name)
                        }
                      >
                        {isCurrent ? "Current plan" : `Upgrade to ${p.name}`}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>

            <Separator />

            <section>
              <div className="mb-3">
                <h3 className="text-sm font-semibold">Top-up packs</h3>
                <p className="text-xs text-muted-foreground">
                  One-time credits. Expire 12 months after purchase.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {packs.map((pack) => (
                  <div
                    key={pack.code}
                    className="rounded-lg border border-border/60 p-3"
                  >
                    <p className="text-sm font-medium">{pack.credits} credits</p>
                    <p className="mt-1 text-base font-semibold tabular-nums">
                      ${(pack.price_cents / 100).toFixed(0)}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!user}
                      className="mt-2 w-full"
                      onClick={() =>
                        startCheckout(
                          `${pack.code}_onetime`,
                          `${pack.credits} credits`,
                        )
                      }
                    >
                      Buy
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            {wallet?.stripe_customer_id && (
              <>
                <Separator />
                <section>
                  <Button
                    variant="ghost"
                    onClick={openPortal}
                    disabled={portalLoading}
                    className="w-full justify-between"
                  >
                    <span>Manage subscription & invoices</span>
                    {portalLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                  </Button>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Opens Stripe's billing portal in a new tab.
                  </p>
                </section>
              </>
            )}
          </div>
        )}

        {view.kind === "checkout" && (
          <div className="mt-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView({ kind: "menu" })}
              className="mb-3"
            >
              ← Back
            </Button>
            <StripeEmbeddedCheckout priceId={view.priceId} returnUrl={returnUrl} />
          </div>
        )}

        {view.kind === "success" && (
          <div className="mt-8 space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Thank you!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your credits will appear in your wallet shortly.
              </p>
            </div>
            <Button onClick={() => setView({ kind: "menu" })} className="w-full">
              Done
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
