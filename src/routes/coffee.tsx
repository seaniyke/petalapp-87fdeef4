import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { CryptoTipPanel } from "@/components/CryptoTipPanel";
import { Coffee, Heart, Loader2, ArrowRight, CreditCard, Bitcoin } from "lucide-react";


export const Route = createFileRoute("/coffee")({
  head: () => ({
    meta: [
      { title: "Buy Petal a coffee — support early access" },
      {
        name: "description",
        content:
          "Petal is in early access, built by a small team. If you like what we're doing, buy us a coffee — it keeps the servers warm.",
      },
      { property: "og:title", content: "Buy Petal a coffee" },
      {
        property: "og:description",
        content: "Support Petal while we're in early access. Every tip helps.",
      },
    ],
  }),
  component: CoffeePage,
});

type Currency = "USD" | "NGN" | "GHS" | "KES" | "ZAR";

const PRESETS: Record<Currency, { label: string; minor: number }[]> = {
  USD: [
    { label: "$3", minor: 300 },
    { label: "$5", minor: 500 },
    { label: "$10", minor: 1000 },
    { label: "$25", minor: 2500 },
  ],
  NGN: [
    { label: "₦500", minor: 500_00 },
    { label: "₦1,000", minor: 1000_00 },
    { label: "₦2,500", minor: 2500_00 },
    { label: "₦5,000", minor: 5000_00 },
  ],
  GHS: [
    { label: "GH₵10", minor: 10_00 },
    { label: "GH₵25", minor: 25_00 },
    { label: "GH₵50", minor: 50_00 },
    { label: "GH₵100", minor: 100_00 },
  ],
  KES: [
    { label: "KSh 100", minor: 100_00 },
    { label: "KSh 250", minor: 250_00 },
    { label: "KSh 500", minor: 500_00 },
    { label: "KSh 1,000", minor: 1000_00 },
  ],
  ZAR: [
    { label: "R30", minor: 30_00 },
    { label: "R60", minor: 60_00 },
    { label: "R120", minor: 120_00 },
    { label: "R250", minor: 250_00 },
  ],
};

function CoffeePage() {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [amountMinor, setAmountMinor] = useState<number>(500);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const finalMinor = customAmount ? Math.round(Number(customAmount) * 100) : amountMinor;
    if (!Number.isFinite(finalMinor) || finalMinor <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    setSubmitting(true);
    try {
      const returnUrl = `${window.location.origin}/coffee/thanks`;
      const res = await fetch("/api/public/coffee/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountMinor: finalMinor,
          currency,
          email: email.trim(),
          name: name.trim() || undefined,
          message: message.trim() || undefined,
          returnUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.authorizationUrl) {
        throw new Error(json.error || `Checkout failed (${res.status})`);
      }
      window.location.href = json.authorizationUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[32rem] bg-aurora opacity-70" aria-hidden />
        <div className="absolute inset-x-0 top-0 h-[32rem] bg-grain opacity-30" aria-hidden />
        <div className="relative mx-auto max-w-2xl px-5 pt-24 pb-24 sm:px-6 sm:pt-32">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-[var(--shadow-soft)] backdrop-blur">
              <Coffee className="h-3.5 w-3.5 text-primary" /> Support the makers
            </div>
            <h1 className="heading-editorial mt-7 text-5xl sm:text-6xl md:text-7xl">
              Buy Petal <em>a cup of coffee.</em>
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
              Petal is built by a small team. If it saved you time or made you smile, drop a tip — it keeps the servers
              warm and the features shipping.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Want to go bigger?{" "}
              <Link to="/invest" className="font-medium text-primary hover:underline">
                Invest in Petal
              </Link>
              .
            </p>
          </div>

          <form
            onSubmit={submit}
            className="mt-10 rounded-3xl border border-border bg-card/90 p-6 shadow-[var(--shadow-soft)] backdrop-blur sm:p-8"
          >
            {/* Currency */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium">Currency</label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PRESETS) as Currency[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCurrency(c);
                      setAmountMinor(PRESETS[c][1].minor);
                      setCustomAmount("");
                    }}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                      currency === c
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount presets */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium">Amount</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRESETS[currency].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setAmountMinor(p.minor);
                      setCustomAmount("");
                    }}
                    className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                      !customAmount && amountMinor === p.minor
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:border-foreground/40"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-3">
                <label className="block text-xs text-muted-foreground">Or a custom amount ({currency})</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  inputMode="decimal"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  placeholder="e.g. 15"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Contact */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Email <span className="text-muted-foreground">(receipt)</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Name <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  placeholder="Your name"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium">
                Note to the team <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                maxLength={280}
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="What did you build with Petal?"
              />
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-medium text-primary-foreground shadow-sm transition hover:brightness-105 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Redirecting…
                </>
              ) : (
                <>
                  <Heart className="h-4 w-4" /> Send tip
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Secure checkout by Paystack. Cards, bank transfer, mobile money.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
