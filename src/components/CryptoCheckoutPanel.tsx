/**
 * CryptoCheckoutPanel — pay for a plan, credit pack or Cloud + AI top-up in
 * crypto, reusing the same public wallets as the /coffee tip flow.
 *
 * Flow: pick a network → send → paste the tx hash. We record it as pending
 * and an admin confirms it on-chain, which credits the account.
 */
import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Bitcoin,
  ShieldCheck,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { ACTIVE_WALLETS, qrUrl } from "@/lib/crypto-tips";
import { supabase } from "@/integrations/supabase/client";

/** What the tracker shows once a hash has been submitted. */
type TrackedStatus = "pending" | "confirmed" | "needs_review" | "rejected";

type Tracked = {
  id: string;
  status: TrackedStatus;
  confirmations: number | null;
  note: string | null;
};

export type CryptoPurpose = "plan" | "pack" | "runtime_topup";

export function CryptoCheckoutPanel({
  purpose,
  itemCode,
  itemLabel,
  usdCents,
  customUsdCents,
  onSubmitted,
}: {
  purpose: CryptoPurpose;
  itemCode: string;
  itemLabel: string;
  /** Display-only — the server re-resolves the real price. */
  usdCents: number;
  /** Only for a custom Cloud top-up amount. */
  customUsdCents?: number;
  onSubmitted?: () => void;
}) {
  const [walletId, setWalletId] = useState(ACTIVE_WALLETS[0]?.id ?? "");
  const wallet = ACTIVE_WALLETS.find((w) => w.id === walletId) ?? ACTIVE_WALLETS[0];
  const [copied, setCopied] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [amountSent, setAmountSent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const trackedRef = useRef<Tracked | null>(null);
  trackedRef.current = tracked;

  // Live status: realtime on the row plus a polled on-demand explorer check,
  // so the user sees pending → confirmed without touching anything.
  useEffect(() => {
    const id = tracked?.id;
    if (!id) return;
    if (tracked.status !== "pending") return;
    let cancelled = false;

    const apply = (row: Record<string, unknown>) => {
      if (cancelled) return;
      setTracked({
        id,
        status: (row.status as TrackedStatus) ?? "pending",
        confirmations: row.confirmations == null ? null : Number(row.confirmations),
        note: (row.verify_note as string) ?? (row.admin_note as string) ?? null,
      });
    };

    const channel = supabase
      .channel(`crypto-pay:${id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "crypto_payments", filter: `id=eq.${id}` },
        (payload) => apply(payload.new as Record<string, unknown>),
      )
      .subscribe();

    const check = async () => {
      if (cancelled || trackedRef.current?.status !== "pending") return;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/billing/crypto/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paymentId: id }),
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => ({}))) as {
        payment?: Record<string, unknown>;
      };
      if (json.payment) apply(json.payment);
    };

    void check();
    const timer = setInterval(check, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [tracked?.id, tracked?.status]);



  if (!wallet) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Crypto payments are being set up — card checkout works right now.
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* address is visible anyway */
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const res = await fetch("/api/billing/crypto", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          purpose,
          itemCode,
          walletId: wallet.id,
          txHash: txHash.trim(),
          amountSent: amountSent ? Number(amountSent) : undefined,
          customUsdCents,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not record your payment.");
      setDone(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-center">
        <ShieldCheck className="mx-auto h-5 w-5 text-primary" />
        <p className="mt-2 text-sm font-semibold">Payment submitted 🙌</p>
        <p className="mt-1 text-xs text-muted-foreground">
          We're confirming it on-chain. {itemLabel} lands on your account as soon
          as it clears — usually within a few minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Bitcoin className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">
          Pay ${(usdCents / 100).toFixed(2)} in crypto
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Send the equivalent of ${(usdCents / 100).toFixed(2)} USD for {itemLabel},
        then paste your transaction hash.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {ACTIVE_WALLETS.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWalletId(w.id)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              w.id === wallet.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {w.asset} · {w.network}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col items-center gap-3 rounded-lg border border-border bg-background/60 p-3 sm:flex-row">
        <img
          src={qrUrl(wallet.address)}
          alt={`QR code for Petal's ${wallet.asset} address`}
          width={104}
          height={104}
          loading="lazy"
          className="h-[104px] w-[104px] shrink-0 rounded-lg bg-white p-1"
        />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="wrap-anywhere font-mono text-xs font-semibold">
            {wallet.address}
          </p>
          {wallet.memo && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Memo/tag: {wallet.memo}
            </p>
          )}
          <button
            type="button"
            onClick={copy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold transition hover:border-foreground/40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy address"}
          </button>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Only send {wallet.asset} on {wallet.network}. Other networks are lost.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-3 space-y-2">
        <input
          type="text"
          required
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          placeholder="Transaction hash (0x… / T…)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
        />
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={amountSent}
          onChange={(e) => setAmountSent(e.target.value)}
          placeholder={`Amount sent in ${wallet.asset} (optional)`}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
        />
        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "Submitting…" : "I've sent the payment"}
        </button>
        <p className="text-center text-[11px] text-muted-foreground">
          Every transfer is verified on-chain before your account is credited.
        </p>
      </form>
    </div>
  );
}
