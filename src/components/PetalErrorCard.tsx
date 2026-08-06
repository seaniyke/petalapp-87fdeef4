/**
 * iOS-inspired notification card for "Petal got confused"-class errors.
 *
 * Used in two places:
 *  1. Live in the BuildActivityCard while a generation is in flight.
 *  2. Persisted inline in the chat thread so the card survives a refresh.
 *
 * Visual language: rounded-3xl, soft layered surfaces, hairline border,
 * SF-style icon glyph in a tinted circle, primary "filled" pill button
 * and secondary glass button — matches iOS 17 system alerts / banners.
 */
import { useState } from "react";
import { RefreshCcw, Wrench, X, ChevronDown, Sparkles } from "lucide-react";
import type { FriendlyError } from "@/lib/friendly-errors";

type Props = {
  error: FriendlyError;
  onRetry?: () => void;
  onAskFix?: () => void;
  onDismiss?: () => void;
  /** Opens the billing sheet for the "buy-credits" action kind. */
  onBuyCredits?: () => void;
  /** When true, the card is being shown from history — hide live-only
   *  affordances like the dismiss "X" if no handler was provided. */
  persisted?: boolean;
};

/**
 * Turn a raw bundler log into one human sentence plus the file it points at.
 * Stack frames ("    at …") are dropped — they are never actionable for the
 * person reading this card, and on a phone they crowded out the real message.
 */
function summarizeTechnicalDetail(
  raw: string | undefined,
): { message: string; location?: string } | null {
  if (!raw) return null;
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^at\s/.test(l));
  if (lines.length === 0) return null;

  const errorLine =
    lines.find((l) => /^(error|x |✘|ERROR)/i.test(l) && !/^error during build/i.test(l)) ??
    lines.find((l) => /error/i.test(l)) ??
    lines[0];

  // "/app/builds/<id>/src/routes/products/$slug.tsx:9:21: ERROR: Expected …"
  const located = /([\w./$@-]+\.[a-z]{2,4}):(\d+):(\d+)/i.exec(errorLine);
  let message = errorLine
    .replace(/^(x|✘)\s*/i, "")
    .replace(/^error(\s+during\s+build)?:?\s*/i, "")
    .replace(/^\[[^\]]+\]\s*/, "");
  let location: string | undefined;
  if (located) {
    message = message.slice(located.index + located[0].length).replace(/^:?\s*(ERROR:)?\s*/i, "");
    const shortPath = located[1].replace(/^.*?\/src\//, "src/");
    location = `${shortPath} · line ${located[2]}`;
  }
  if (!message) message = errorLine;
  return { message: message.slice(0, 240), location };
}

export function PetalErrorCard({ error, onRetry, onAskFix, onDismiss, onBuyCredits }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const summary = summarizeTechnicalDetail(error.technicalDetail);

  // Design Bible §10 / C7 — when Petal retries on its own, the card states it
  // and offers no button. Copy and behaviour never disagree.
  const autoRetrying = error.autoRetrying === true;
  const isAskFix = !autoRetrying && error.actionKind === "ask-fix";
  const isRetry = !autoRetrying && error.actionKind === "retry";
  const isDismiss = !autoRetrying && error.actionKind === "dismiss";
  const isBuyCredits = !autoRetrying && error.actionKind === "buy-credits";




  return (
    <div className="mr-2 w-full max-w-[520px]">
      {/* Outer surface — soft elevated card, hairline border, iOS radius. */}
      <div
        className={[
          "relative overflow-hidden rounded-3xl",
          "border border-foreground/8 dark:border-white/8",
          "bg-[color-mix(in_oklab,var(--card)_92%,transparent)]",
          "shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset,0_8px_30px_-12px_rgba(0,0,0,0.18)]",
          "backdrop-blur-xl",
        ].join(" ")}
      >
        {/* Subtle top sheen to mimic iOS material */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10"
        />

        <div className="flex items-start gap-3 px-4 py-3.5">
          {/* Tinted glyph bubble (SF-icon style) */}
          <div
            className={[
              "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              isAskFix
                ? "bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-primary"
                : isBuyCredits
                  ? "bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-primary"
                  : "bg-[color-mix(in_oklab,#f59e0b_18%,transparent)] text-amber-600 dark:text-amber-400",
            ].join(" ")}
            aria-hidden
          >
            {isAskFix ? (
              <Wrench className="h-4 w-4" strokeWidth={2.25} />
            ) : isBuyCredits ? (
              <Sparkles className="h-4 w-4" strokeWidth={2.25} />
            ) : (
              // iOS-style "exclamationmark" in a circle — drawn with text for crispness
              <span className="text-[15px] font-semibold leading-none">!</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
              {error.title}
            </div>
            <div className="mt-0.5 text-[13.5px] leading-snug text-muted-foreground">
              {error.message}
            </div>

            {/* Action row — iOS pill buttons */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {isRetry && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-semibold text-background transition active:scale-[0.97]"
                >
                  <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {error.actionLabel}
                </button>
              )}
              {isAskFix && onAskFix && (
                <button
                  type="button"
                  onClick={onAskFix}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition active:scale-[0.97]"
                >
                  <Wrench className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {error.actionLabel}
                </button>
              )}
              {isBuyCredits && onBuyCredits && (
                <button
                  type="button"
                  onClick={onBuyCredits}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition active:scale-[0.97]"
                >
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {error.actionLabel}
                </button>
              )}
              {isDismiss && onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-foreground/12 bg-background/60 px-3.5 text-[13px] font-medium text-foreground transition active:scale-[0.97]"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {error.actionLabel}
                </button>
              )}

              {error.technicalDetail && (
                <button
                  type="button"
                  onClick={() => setShowDetails((s) => !s)}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
                  aria-expanded={showDetails}
                >
                  {showDetails ? "Hide details" : "What went wrong"}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${showDetails ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>

            {showDetails && error.technicalDetail && (
              <div className="mt-2.5 min-w-0 space-y-2">
                {/* Plain-language summary first — the raw stack is noise for
                    most people and, on a phone, it used to be the only thing
                    they could see. */}
                {summary && (
                  <div className="min-w-0 rounded-2xl border border-foreground/8 bg-background/60 p-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      The problem
                    </div>
                    <p className="mt-1 break-words text-[12.5px] leading-snug text-foreground">
                      {summary.message}
                    </p>
                    {summary.location && (
                      <p className="mt-1 break-all font-mono text-[11px] leading-snug text-muted-foreground">
                        {summary.location}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRaw((s) => !s)}
                    className="inline-flex h-7 items-center rounded-full border border-foreground/12 px-2.5 text-[11.5px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    {showRaw ? "Hide technical log" : "Technical log"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(error.technicalDetail ?? "")
                        .then(() => setCopied(true))
                        .then(() => window.setTimeout(() => setCopied(false), 1600));
                    }}
                    className="inline-flex h-7 items-center rounded-full border border-foreground/12 px-2.5 text-[11.5px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    {copied ? "Copied" : "Copy log"}
                  </button>
                </div>

                {showRaw && (
                  <pre className="max-h-44 w-full min-w-0 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-foreground/8 bg-background/60 p-2.5 text-[11px] leading-snug text-muted-foreground">
                    {error.technicalDetail}
                  </pre>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
