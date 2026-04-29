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
import { pollDomainRegistrations } from "@/lib/registrar";

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
  | { kind: "registering-domain"; hostname?: string }
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
        // Only honor returnTo when it's a same-origin in-app path —
        // protects against open-redirect attacks via crafted Paystack URLs.
        const safeReturnTo =
          search.returnTo && search.returnTo.startsWith("/") && !search.returnTo.startsWith("//")
            ? search.returnTo
            : null;
        if (json.status === "success") {
          const purpose = json.purpose ?? "purchase";
          setState({ kind: "success", purpose });
          refresh();
          setTimeout(() => refresh(), 2000);

          // Domain purchases need an extra step: nudge the server to poll
          // Cloudflare's async registration workflow until it completes.
          if (purpose === "domain_purchase") {
            setState({ kind: "registering-domain" });
            const ref = reference;
            (async () => {
              for (let i = 0; i < 8 && !cancelled; i++) {
                try {
                  const { updates } = await pollDomainRegistrations({ reference: ref });
                  const u = updates[0];
                  if (cancelled) return;
                  if (u?.status === "active") {
                    setState({ kind: "success", purpose: "domain_purchase" });
                    return;
                  }
                  if (u?.status === "failed") {
                    setState({
                      kind: "failed",
                      message:
                        "We couldn't finish registering your domain. Our team has been notified.",
                    });
                    return;
                  }
                  setState({ kind: "registering-domain", hostname: u?.hostname });
                } catch {
                  /* keep retrying */
                }
                await new Promise((r) => setTimeout(r, 4000));
              }
            })();
          }

          if (safeReturnTo) {
            // Brief pause so the user sees the success state before bouncing.
            setTimeout(() => {
              if (!cancelled) window.location.replace(safeReturnTo);
            }, 1500);
          }
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
              if (safeReturnTo) {
                setTimeout(() => {
                  if (!cancelled) window.location.replace(safeReturnTo);
                }, 1500);
              }
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
  }, [reference, refresh, search.returnTo]);

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
          <h1 className="text-2xl font-semibold">
            {state.purpose === "domain_purchase"
              ? "Domain registered"
              : "Payment received"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {state.purpose === "plan"
              ? "Your plan is active. We've added $5 of runtime credit so you can spin up backends, email, and domains right away."
              : state.purpose === "domain_purchase"
              ? "Your domain is live. We've connected it to your project and SSL is provisioning — usually ready within a minute."
              : "Your credits have been added to your wallet."}
          </p>
        </>
      )}

      {state.kind === "registering-domain" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <h1 className="mt-4 text-xl font-semibold">Registering your domain…</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.hostname
              ? `Cloudflare is finalising ${state.hostname}. This usually takes 10–60 seconds.`
              : "Cloudflare is finalising your domain. This usually takes 10–60 seconds."}
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
