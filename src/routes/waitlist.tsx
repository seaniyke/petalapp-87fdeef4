/**
 * Waitlist status page — /waitlist?t=<status token>
 *
 * The viral surface: your place in line, your invite link, and how much
 * closer each friend gets you. No account required.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Copy, Check, Share2, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import {
  AUTO_APPROVE_AT,
  REFERRAL_JUMP,
  readStatusToken,
  rememberStatusToken,
  shareText,
  shareUrl,
} from "@/lib/referral";

type Status = {
  name: string;
  email: string;
  referral_code: string;
  referral_count: number;
  queue_position: number;
  total: number;
  approved: boolean;
  created_at: string;
};

export const Route = createFileRoute("/waitlist")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search.t === "string" ? search.t : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Your spot in line · Petal" },
      {
        name: "description",
        content:
          "Track your place in the Petal waitlist and jump the queue by inviting friends.",
      },
      { property: "og:title", content: "Your spot in line · Petal" },
      {
        property: "og:description",
        content: "Invite friends, move up the Petal waitlist, start building sooner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WaitlistStatusPage,
});

function WaitlistStatusPage() {
  const { t } = Route.useSearch();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = t || readStatusToken();
    if (!token) {
      setLoading(false);
      return;
    }
    rememberStatusToken(token);
    fetch(`/api/public/waitlist?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => setStatus((j as { status?: Status }).status ?? null))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [t]);

  const link = status ? shareUrl(status.referral_code) : "";

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
    if (!status) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Petal", text: shareText(status.referral_code), url: link });
        return;
      } catch {
        /* user cancelled */
      }
    }
    void copy();
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-aurora opacity-70" aria-hidden />
      <div className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-16 sm:px-8">
        <Link to="/" className="mb-8 inline-flex items-center gap-2.5">
          <img src="/petal-logo.png" alt="" aria-hidden className="h-9 w-9 object-contain" />
          <span className="font-display text-2xl font-black tracking-[-0.035em]">Petal</span>
        </Link>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding your spot…
          </div>
        ) : !status ? (
          <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)]">
            <h1 className="font-display text-3xl font-black tracking-[-0.03em]">
              We couldn't find that spot
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Open the link from your confirmation email, or join the list again — it
              only takes a second.
            </p>
            <Link
              to="/auth"
              className="mt-6 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground hover:brightness-105"
            >
              Join the waitlist
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl border border-border bg-card p-7 shadow-[var(--shadow-soft)] sm:p-8">
              {status.approved ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground">
                    <Trophy className="h-3 w-3" /> You're in
                  </span>
                  <h1 className="mt-5 font-display text-4xl font-black leading-[1.03] tracking-[-0.035em]">
                    Line skipped.
                  </h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Your spot is open — sign in with {status.email} and start building.
                  </p>
                  <Link
                    to="/auth"
                    search={{ mode: "signup" }}
                    className="mt-6 inline-flex h-12 items-center rounded-full bg-primary px-6 text-base font-medium text-primary-foreground hover:brightness-105"
                  >
                    Start building
                  </Link>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    <Sparkles className="h-3 w-3" /> Your spot
                  </span>
                  <h1 className="mt-5 font-display text-6xl font-black leading-none tracking-[-0.04em]">
                    #{status.queue_position}
                  </h1>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    out of {status.total.toLocaleString()} people waiting. Every friend
                    who joins with your link moves you up {REFERRAL_JUMP} spots —{" "}
                    {AUTO_APPROVE_AT} friends and you're straight in.
                  </p>
                  <div className="mt-5 flex items-center gap-1.5">
                    {Array.from({ length: AUTO_APPROVE_AT }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-2 flex-1 rounded-full ${
                          i < status.referral_count ? "bg-primary" : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {status.referral_count} of {AUTO_APPROVE_AT} friends joined
                  </p>
                </>
              )}
            </div>

            <div className="rounded-3xl border border-border bg-card p-7 shadow-[var(--shadow-soft)] sm:p-8">
              <h2 className="font-display text-xl font-black tracking-[-0.02em]">
                Your invite link
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Send it anywhere. You both get credits when they start building.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <code className="flex-1 truncate rounded-xl border border-border bg-background px-4 py-3 text-sm">
                  {link}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  aria-label="Copy invite link"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border hover:bg-muted"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={share}
                className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-medium text-primary-foreground transition hover:brightness-105"
              >
                <Share2 className="h-4 w-4" /> Share your link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
