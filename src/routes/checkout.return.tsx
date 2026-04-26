/**
 * /checkout/return — landing page after Stripe embedded checkout completes.
 * Stripe replaces {CHECKOUT_SESSION_ID} in the return_url with the real id.
 *
 * We don't trust the redirect for fulfillment — the webhook does that.
 * This page just confirms to the user and points them home.
 */
import { useEffect } from "react";
import { Link, createFileRoute, useSearch } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";

const SearchSchema = z.object({
  session_id: z.string().optional(),
});

export const Route = createFileRoute("/checkout/return")({
  validateSearch: SearchSchema,
  component: CheckoutReturn,
  head: () => ({
    meta: [
      { title: "Checkout complete — Petal" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function CheckoutReturn() {
  const { session_id } = useSearch({ from: "/checkout/return" });
  const { refresh } = useWallet();

  // The webhook may take a beat; refresh a couple times so the badge updates.
  useEffect(() => {
    const t1 = setTimeout(() => refresh(), 1500);
    const t2 = setTimeout(() => refresh(), 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h1 className="text-2xl font-semibold">Payment received</h1>
      <p className="mt-2 text-muted-foreground">
        Thanks! Your credits will appear in your wallet within a few seconds.
      </p>
      {session_id && (
        <p className="mt-4 max-w-full truncate text-[11px] text-muted-foreground">
          Reference: {session_id}
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
