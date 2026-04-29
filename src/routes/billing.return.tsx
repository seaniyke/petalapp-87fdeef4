/**
 * /billing/return — landing page after Paystack hosted checkout.
 * Paystack appends ?reference=... to the callback_url. We verify with our
 * server (which double-checks with Paystack and grants credits if needed),
 * then refresh the wallet so the badge updates.
 */
import { useEffect, useState } from "react";
import { Link, createFileRoute, useSearch } from "@tanstack/react-router";
import { Loader2, Sparkles, XCircle } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { supabase } from "@/integrations/supabase/client";

const SearchSchema = z.object({
  reference: z.string().optional(),
  trxref: z.string().optional(),
  // Optional in-app path to bounce back to after a successful payment.
  // Only honored if it's a same-origin path (must start with `/`).
  returnTo: z.string().optional(),
});

type VerifyState =
  | { kind: "loading" }
  | { kind: "success"; purpose: string }
  | { kind: "pending" }
  | { kind: "failed"; message: string };

export const Route = createFileRoute("/billing/return")({
  validateSearch: SearchSchema,
  component: BillingReturn,
  head: () => ({
    meta: [
      { title: "Payment status — Petal" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function BillingReturn() {
  const search = useSearch({ from: "/billing/return" });
  const reference = search.reference || search.trxref;
  const { refresh } = useWallet();
  const [state, setState] = useState<VerifyState>({ kind: "loading" });

  useEffect(() => {
    if (!reference) {
      setState({ kind: "failed", message: "Missing payment reference." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          setState({ kind: "failed", message: "Please sign in to confirm your payment." });
          return;
        }
        const res = await fetch(
          `/api/billing/verify?reference=${encodeURIComponent(reference)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (cancelled) return;
        if (!res.ok) {
          setState({ kind: "failed", message: `Verification failed (${res.status}).` });
          return;
        }
        const json = (await res.json()) as { status?: string; purpose?: string };
        if (json.status === "success") {
          setState({ kind: "success", purpose: json.purpose ?? "purchase" });
          refresh();
          setTimeout(() => refresh(), 2000);
        } else if (json.status === "failed" || json.status === "abandoned") {
          setState({
            kind: "failed",
            message: "Your payment didn't go through. No charge was made.",
          });
        } else {
          setState({ kind: "pending" });
          // Try once more after a short delay.
          setTimeout(async () => {
            const r2 = await fetch(
              `/api/billing/verify?reference=${encodeURIComponent(reference)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            const j2 = (await r2.json()) as { status?: string; purpose?: string };
            if (cancelled) return;
            if (j2.status === "success") {
              setState({ kind: "success", purpose: j2.purpose ?? "purchase" });
              refresh();
            }
          }, 4000);
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "failed",
            message: err instanceof Error ? err.message : "Unexpected error.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reference, refresh]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      {state.kind === "loading" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Confirming your payment…</p>
        </>
      )}

      {state.kind === "success" && (
        <>
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">Payment received</h1>
          <p className="mt-2 text-muted-foreground">
            {state.purpose === "plan"
              ? "Your plan is active and credits are in your wallet."
              : "Your credits have been added to your wallet."}
          </p>
        </>
      )}

      {state.kind === "pending" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <h1 className="mt-4 text-xl font-semibold">Almost there</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your bank is still confirming. Credits usually appear in under a minute.
          </p>
        </>
      )}

      {state.kind === "failed" && (
        <>
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <XCircle className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="text-2xl font-semibold">Payment not completed</h1>
          <p className="mt-2 text-muted-foreground">{state.message}</p>
        </>
      )}

      {reference && (
        <p className="mt-4 max-w-full truncate text-[11px] text-muted-foreground">
          Reference: {reference}
        </p>
      )}

      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link to="/projects">Go to projects</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
