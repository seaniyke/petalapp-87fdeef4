/**
 * PaymentsSheet — payments setup for the app being built.
 *
 * Kimble builds payments into the project from a prompt: it picks the right
 * provider for what the app sells, scaffolds checkout + webhooks, and asks
 * for any keys inline. This sheet is the front door for that flow.
 */
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CreditCard, Receipt, RefreshCw, ShoppingBag } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when the project already has a managed backend. */
  hasBackend: boolean | null;
  onSendPrompt: (prompt: string) => void;
  onSetupBackend: () => void;
};

const OPTIONS = [
  {
    icon: ShoppingBag,
    title: "One-off checkout",
    body: "Sell a product or service with a hosted checkout and a success page.",
    prompt:
      "Add one-off payments to this app using Kimble's built-in payments. Pick the right provider, scaffold a hosted checkout, a success page and the webhook that marks an order as paid.",
  },
  {
    icon: RefreshCw,
    title: "Subscriptions",
    body: "Recurring plans with upgrade, downgrade and cancel handled for you.",
    prompt:
      "Add subscription billing to this app using Kimble's built-in payments. Create the plans, the checkout, the customer portal link and the webhook that keeps subscription status in sync.",
  },
  {
    icon: Receipt,
    title: "Invoices & receipts",
    body: "Email a PDF receipt after every successful payment.",
    prompt:
      "After a successful payment in this app, generate a PDF receipt and email it to the customer. Store the receipt against the order.",
  },
];

export function PaymentsSheet({
  open,
  onOpenChange,
  hasBackend,
  onSendPrompt,
  onSetupBackend,
}: Props) {
  const needsBackend = hasBackend === false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Payments
          </SheetTitle>
          <SheetDescription>
            Take money in your app. Kimble picks the provider, builds checkout
            and wires the webhooks.
          </SheetDescription>
        </SheetHeader>

        {needsBackend && (
          <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm font-semibold">Your app needs a backend first</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Payment webhooks need somewhere to run. It takes one tap.
            </p>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSetupBackend();
              }}
              className="mt-3 inline-flex items-center rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-105"
            >
              Set up backend
            </button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {OPTIONS.map((opt) => (
            <button
              key={opt.title}
              type="button"
              disabled={needsBackend}
              onClick={() => {
                onOpenChange(false);
                onSendPrompt(opt.prompt);
              }}
              className="flex w-full items-start gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left transition hover:border-primary/40 hover:bg-muted/40 disabled:opacity-50"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-primary">
                <opt.icon className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{opt.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {opt.body}
                </span>
              </span>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
