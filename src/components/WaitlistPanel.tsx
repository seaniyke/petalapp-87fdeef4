/**
 * Waitlist gate shown on /auth while waitlist mode is on.
 *
 * Collects a name + email, posts to /api/public/waitlist, and keeps a quiet
 * "I already have access" escape hatch so the team can still sign in.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, CheckCircle2, Sparkles } from "lucide-react";

type Props = {
  /** Reveals the normal sign-in form. */
  onHaveAccess: () => void;
};

export function WaitlistPanel({ onHaveAccess }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { already: boolean }>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/public/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), source: "auth" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        alreadyJoined?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not save your spot.");
      setDone({ already: Boolean(json.alreadyJoined) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora opacity-70" aria-hidden />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-16 sm:px-8">
        <Link to="/" className="mb-8 inline-flex items-center gap-2.5">
          <img src="/petal-logo.png" alt="" aria-hidden className="h-9 w-9 object-contain" />
          <span className="font-display text-2xl font-black tracking-[-0.035em]">Petal</span>
        </Link>

        {done ? (
          <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)]">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-mint">
              <CheckCircle2 className="h-6 w-6 text-foreground" />
            </div>
            <h1 className="font-display text-3xl font-black tracking-[-0.03em]">
              {done.already ? "You're already in line" : "You're on the list"}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              We're letting people in gradually so every build stays fast. We'll
              email <span className="text-foreground">{email}</span> the moment your
              spot opens.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:brightness-105"
            >
              Back to Petal
            </Link>
          </div>
        ) : (
          <div className="rounded-3xl border border-border bg-card p-7 shadow-[var(--shadow-soft)] sm:p-8">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Early access
            </span>
            <h1 className="mt-5 font-display text-4xl font-black leading-[1.03] tracking-[-0.035em]">
              Petal is invite-only <em className="italic">for now.</em>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Drop your name and email — we're opening spots in batches, and you'll
              be first to know.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-3">
              <input
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary"
              />
              <input
                type="email"
                required
                maxLength={255}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-12 w-full rounded-xl border border-border bg-background px-4 text-sm outline-none focus:border-primary"
              />
              {error && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? "Saving your spot…" : "Get early access"}
              </button>
            </form>

            <button
              type="button"
              onClick={onHaveAccess}
              className="mt-5 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              I already have access — sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
