/**
 * CapabilityAskInline — Petal asking, in plain chat, before it wires up a
 * capability (backend, payments, email).
 *
 * This replaces the three coloured "Enable X" banner chips. Banners were
 * loud, fired on weak signals, and read like an upsell. A short question in
 * Petal's own voice with two quiet inline replies reads like a colleague
 * checking in — and it only ever appears when `detectCapabilityAsk` is
 * confident the user actually asked for the thing.
 */
import { Check, X } from "lucide-react";

export type CapabilityKind = "backend" | "payment" | "email";

type Props = {
  kind: CapabilityKind;
  /** Short snippet of what the user said that prompted the question. */
  reason?: string;
  /** Payments/email need somewhere to run — offer the backend first. */
  needsBackendFirst?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

function question(kind: CapabilityKind, reason: string | undefined, needsBackendFirst: boolean) {
  const about = reason ? ` for ${reason}` : "";
  if (needsBackendFirst) {
    return `That needs somewhere to run first${about ? ` — ${reason} won't work without it` : ""}. Want me to set up your app's backend now?`;
  }
  switch (kind) {
    case "backend":
      return `To do that properly I'll need a backend${about ? ` so ${reason} is saved for real` : ""}. Want me to set it up?`;
    case "payment":
      return `I can wire up real checkout${about ? ` for ${reason}` : ""} — no API keys needed. Want me to?`;
    case "email":
      return `I can set up real email sending${about ? ` for ${reason}` : ""}. Want me to?`;
  }
}

export function CapabilityAskInline({
  kind,
  reason,
  needsBackendFirst = false,
  onConfirm,
  onDismiss,
}: Props) {
  return (
    <div className="mt-2 text-[13px] leading-relaxed">
      <p className="text-foreground/80">{question(kind, reason, needsBackendFirst)}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-[12px] font-medium transition hover:border-foreground/40 hover:bg-muted/60"
        >
          <Check className="h-3 w-3" />
          Yes, set it up
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-muted-foreground transition hover:bg-muted/60"
        >
          <X className="h-3 w-3" />
          Not now
        </button>
      </div>
    </div>
  );
}
