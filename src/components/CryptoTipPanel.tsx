/**
 * CryptoTipPanel — send Petal a coffee in crypto.
 *
 * Shows Petal's public receiving wallets (address + QR), then lets the
 * supporter log the transaction hash so we can confirm it on-chain and
 * thank them. No funds pass through Petal's servers.
 */
import { useState } from "react";
import { Check, Copy, Loader2, Heart, Wallet } from "lucide-react";
import { ACTIVE_WALLETS, qrUrl } from "@/lib/crypto-tips";

export function CryptoTipPanel() {
  const [walletId, setWalletId] = useState(ACTIVE_WALLETS[0]?.id ?? "");
  const wallet = ACTIVE_WALLETS.find((w) => w.id === walletId) ?? ACTIVE_WALLETS[0];
  const [copied, setCopied] = useState(false);
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wallet) {
    return (
      <div className="rounded-3xl border border-border bg-card/90 p-8 text-center shadow-[var(--shadow-soft)]">
        <Wallet className="mx-auto h-6 w-6 text-primary" />
        <p className="mt-3 text-sm font-semibold">Crypto tips are being set up.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Our wallets go live shortly — card checkout works right now.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the address is visible anyway */
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter the amount you sent.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/coffee/crypto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: wallet.asset,
          chain: wallet.network,
          walletAddress: wallet.address,
          amount: value,
          txHash: txHash.trim(),
          email: email.trim(),
          name: name.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not record your tip.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-3xl border border-border bg-card/90 p-8 text-center shadow-[var(--shadow-soft)]">
        <Heart className="mx-auto h-7 w-7 text-primary" />
        <h2 className="mt-3 text-xl font-bold">Got it — thank you! 🙏</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We'll confirm the transfer on-chain and drop you a note at {email}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-card/90 p-6 shadow-[var(--shadow-soft)] backdrop-blur sm:p-8">
      {/* Wallet picker */}
      <label className="mb-2 block text-sm font-semibold">Choose a network</label>
      <div className="flex flex-wrap gap-2">
        {ACTIVE_WALLETS.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWalletId(w.id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
              w.id === wallet.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {w.asset} · {w.network}
          </button>
        ))}
      </div>

      {/* Address + QR */}
      <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl border border-border bg-background/60 p-4 sm:flex-row sm:items-center">
        <img
          src={qrUrl(wallet.address)}
          alt={`QR code for Petal's ${wallet.asset} address`}
          width={132}
          height={132}
          loading="lazy"
          className="h-[132px] w-[132px] shrink-0 rounded-xl bg-white p-1"
        />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {wallet.asset} · {wallet.network}
          </p>
          <p className="mt-1 wrap-anywhere font-mono text-sm font-semibold">{wallet.address}</p>
          {wallet.memo && (
            <p className="mt-1 text-xs text-muted-foreground">Memo/tag: {wallet.memo}</p>
          )}
          <button
            type="button"
            onClick={copy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-semibold transition hover:border-foreground/40"
          >
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy address"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Only send {wallet.asset} on {wallet.network}. Other networks will be lost.
          </p>
        </div>
      </div>

      {/* Confirm form */}
      <form onSubmit={submit} className="mt-6">
        <p className="text-sm font-semibold">Sent it? Tell us so we can say thanks.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold">Amount ({wallet.asset})</label>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 10"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">Transaction hash</label>
            <input
              type="text"
              required
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="0x… / T…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold">
              Name <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-sm font-semibold">
            Note to the team <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={280}
            placeholder="What did you build with Petal?"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <Heart className="h-4 w-4" /> I've sent my tip
            </>
          )}
        </button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          We verify every transfer on-chain before it shows up as confirmed.
        </p>
      </form>
    </div>
  );
}
