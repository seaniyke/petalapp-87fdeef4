/**
 * Inline chat card: "Install <Integration> with one click".
 *
 * Streamed by the AI as `<lov-suggest-integration code="stripe" />` whenever
 * the auto-suggest classifier matches the user's intent. The actual install
 * dialog lives in IntegrationsSection — this card just deep-links to it.
 */
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

const META: Record<string, { name: string; tagline: string }> = {
  stripe: { name: "Stripe", tagline: "Global card + wallet payments." },
  paystack: { name: "Paystack", tagline: "African card, bank, and mobile-money." },
  flutterwave: { name: "Flutterwave", tagline: "Pan-African + global payments." },
  resend: { name: "Resend", tagline: "Transactional email with a sane API." },
  plausible: { name: "Plausible", tagline: "Privacy-friendly analytics." },
};

export function SuggestedIntegrationCard({ code }: { code: string }) {
  const m = META[code] ?? { name: code, tagline: "Install via the marketplace." };
  return (
    <div className="my-2 flex items-start gap-3 rounded-lg border bg-card p-3 text-sm">
      <Sparkles className="mt-0.5 h-4 w-4 text-amber-500" />
      <div className="flex-1">
        <div className="font-medium">Suggested: install {m.name}</div>
        <p className="text-xs text-muted-foreground">
          {m.tagline} Petal can wire it up in one click instead of hand-rolling the SDK.
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => {
          // Open the marketplace section. The exact UX hook lives in
          // IntegrationsSection; we use a custom event so this card stays
          // decoupled from the parent layout.
          window.dispatchEvent(
            new CustomEvent("petal:open-integration", { detail: { code } }),
          );
        }}
      >
        Install
      </Button>
    </div>
  );
}
