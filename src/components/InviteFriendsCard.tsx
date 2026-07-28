/**
 * Invite card — the signed-in half of the growth loop.
 *
 * Every account has a referral code (created lazily on first sign-in), so
 * users can keep inviting long after the waitlist lets them in.
 */
import { useEffect, useState } from "react";
import { Copy, Check, Share2, Gift } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getMyReferral } from "@/lib/waitlist-referral.functions";
import { REFERRER_CREDITS, REFERRED_CREDITS, shareText, shareUrl } from "@/lib/referral";

type Referral = { code: string; invited: number; joined: number; creditsEarned: number };

export function InviteFriendsCard() {
  const fetchReferral = useServerFn(getMyReferral);
  const [data, setData] = useState<Referral | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchReferral()
      .then((r) => {
        if (alive) setData((r as Referral | null) ?? null);
      })
      .catch(() => {
        /* invite card is optional chrome */
      });
    return () => {
      alive = false;
    };
  }, [fetchReferral]);

  if (!data) return null;
  const link = shareUrl(data.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied — go send it 🌸");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy. Long-press the link instead.");
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Petal", text: shareText(data!.code), url: link });
        return;
      } catch {
        /* cancelled */
      }
    }
    void copy();
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Invite friends
      </h2>
      <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Gift className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium tracking-tight">Give {REFERRED_CREDITS}, get {REFERRER_CREDITS}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Friends who start building with your link get {REFERRED_CREDITS} credits — you
              get {REFERRER_CREDITS} for each one.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
            {link}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy invite link"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={share}
            aria-label="Share invite link"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:brightness-105"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <Stat label="Invited" value={data.invited} />
          <Stat label="Started building" value={data.joined} />
          <Stat label="Credits earned" value={data.creditsEarned} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2.5">
      <div className="font-display text-xl font-black tracking-[-0.02em]">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
