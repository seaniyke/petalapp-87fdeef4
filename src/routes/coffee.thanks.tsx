import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { SiteHeader } from "@/components/SiteHeader";
import { Heart, Loader2, XCircle, ArrowRight } from "lucide-react";

const SearchSchema = z.object({
  reference: z.string().optional(),
  trxref: z.string().optional(),
});

export const Route = createFileRoute("/coffee/thanks")({
  validateSearch: SearchSchema,
  head: () => ({
    meta: [
      { title: "Thank you — Petal" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ThanksPage,
});

type State =
  | { kind: "loading" }
  | { kind: "success" }
  | { kind: "pending" }
  | { kind: "failed"; message: string };

function ThanksPage() {
  const search = useSearch({ from: "/coffee/thanks" });
  const reference = search.reference || search.trxref;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!reference) {
      setState({ kind: "failed", message: "Missing payment reference." });
      return;
    }
    let cancelled = false;
    const tick = async (attempt: number) => {
      try {
        const res = await fetch(
          `/api/public/coffee/verify?reference=${encodeURIComponent(reference)}`,
        );
        const json = (await res.json().catch(() => ({}))) as { status?: string };
        if (cancelled) return;
        if (json.status === "success") {
          setState({ kind: "success" });
        } else if (json.status === "failed" || json.status === "abandoned") {
          setState({
            kind: "failed",
            message: "Your payment didn't go through. No charge was made.",
          });
        } else if (attempt < 4) {
          setState({ kind: "pending" });
          setTimeout(() => tick(attempt + 1), 2500);
        } else {
          setState({ kind: "pending" });
        }
      } catch {
        if (!cancelled) setState({ kind: "failed", message: "Could not verify." });
      }
    };
    tick(0);
    return () => {
      cancelled = true;
    };
  }, [reference]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-96 bg-aurora opacity-70" aria-hidden />
        <div className="relative mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 pt-32 pb-16 text-center">
          {state.kind === "loading" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">
                Confirming your tip…
              </p>
            </>
          )}

          {state.kind === "success" && (
            <>
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-coral/30">
                <Heart className="h-8 w-8 text-coral" />
              </div>
              <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                Thank you. Really.
              </h1>
              <p className="mt-4 max-w-md text-base text-muted-foreground sm:text-lg">
                Your tip lands directly with the team building Petal. Every
                coffee keeps the servers warm and the next feature shipping.
                We won't forget it.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/"
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:brightness-105"
                >
                  Back to Petal <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/invest"
                  className="inline-flex h-11 items-center rounded-full border border-border px-6 text-sm font-medium hover:bg-muted"
                >
                  Want to invest in Petal?
                </Link>
              </div>
            </>
          )}

          {state.kind === "pending" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <h1 className="mt-4 font-display text-2xl font-semibold">
                Almost there
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your bank is still confirming. This usually takes under a minute.
              </p>
            </>
          )}

          {state.kind === "failed" && (
            <>
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <XCircle className="h-7 w-7 text-destructive" />
              </div>
              <h1 className="font-display text-2xl font-semibold">
                Payment not completed
              </h1>
              <p className="mt-2 text-muted-foreground">{state.message}</p>
              <div className="mt-6 flex gap-3">
                <Link
                  to="/coffee"
                  className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:brightness-105"
                >
                  Try again
                </Link>
                <Link
                  to="/"
                  className="inline-flex h-11 items-center rounded-full border border-border px-6 text-sm font-medium hover:bg-muted"
                >
                  Home
                </Link>
              </div>
            </>
          )}

          {reference && (
            <p className="mt-6 max-w-full truncate text-[11px] text-muted-foreground">
              Reference: {reference}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
