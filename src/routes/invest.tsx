import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { TrendingUp, Loader2, CheckCircle2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/invest")({
  head: () => ({
    meta: [
      { title: "Invest in Petal — $40,000 for 10%" },
      {
        name: "description",
        content:
          "Petal is raising $40,000 for 10% equity. Join the early investor waitlist and we'll follow up with the paperwork.",
      },
      { property: "og:title", content: "Invest in Petal" },
      {
        property: "og:description",
        content: "Back the AI builder for web, mobile, backends and extensions.",
      },
    ],
  }),
  component: InvestPage,
});

function InvestPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [contactPref, setContactPref] = useState<"email" | "whatsapp" | "call">("email");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const amountUsd = amount ? Math.round(Number(amount)) : undefined;
      const res = await fetch("/api/public/invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          amountUsd,
          note: note.trim() || undefined,
          contactPref,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not submit.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[28rem] bg-aurora opacity-70" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-5 pt-32 pb-24 sm:px-6">
          <div className="text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <TrendingUp className="h-3.5 w-3.5" /> Early investor round
            </div>
            <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
              Invest in Petal.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
              Petal is raising <strong className="text-foreground">$40,000 for 10% equity</strong>{" "}
              to grow the AI builder for web, mobile, backends and Chrome
              extensions. Join the investor waitlist and we'll follow up with
              the deck and paperwork.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-[1.1fr_1fr]">
            {/* Highlights */}
            <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
              <h2 className="font-display text-xl font-semibold">Why now</h2>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  Live product in early access, shipping updates every week.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  Four build targets: web apps, iOS + Android, backends, Chrome extensions.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  Built-in payments, domains, email and hosting.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  Small, focused team. Every dollar goes into GPU credits and shipping.
                </li>
              </ul>
              <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                Not a public offering. This is a waitlist to signal
                interest — no charge, no commitment. We'll follow up with a
                deck, SAFE terms, and KYC before any funds move.
              </div>
              <p className="mt-6 text-sm">
                Prefer to help in a smaller way?{" "}
                <Link to="/coffee" className="text-primary hover:underline">
                  Buy us a coffee
                </Link>
                .
              </p>
            </div>

            {/* Form */}
            <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
              {done ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-mint">
                    <CheckCircle2 className="h-7 w-7 text-foreground" />
                  </div>
                  <h3 className="font-display text-2xl font-semibold">You're on the list.</h3>
                  <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                    Thanks {name.split(" ")[0] || "friend"} — we'll be in touch
                    within a few days with the deck and next steps.
                  </p>
                  <Link
                    to="/"
                    className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:brightness-105"
                  >
                    Back to Petal <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Full name</label>
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="Ada Lovelace"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Email</label>
                    <input
                      type="email"
                      required
                      maxLength={255}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="you@example.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Amount you're considering (USD)
                    </label>
                    <input
                      type="number"
                      min="100"
                      step="100"
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="e.g. 5000"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Preferred contact</label>
                    <div className="flex flex-wrap gap-2">
                      {(["email", "whatsapp", "call"] as const).map((c) => (
                        <button
                          type="button"
                          key={c}
                          onClick={() => setContactPref(c)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition ${
                            contactPref === c
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Anything you'd like us to know?{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </label>
                    <textarea
                      rows={3}
                      maxLength={1500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="Investor background, timeline, questions…"
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                      </>
                    ) : (
                      <>Join the investor waitlist</>
                    )}
                  </button>
                  <p className="text-center text-xs text-muted-foreground">
                    No charge. We'll email you within a few days.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
