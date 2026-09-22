/**
 * RuntimeTopupModal — kept as a thin compatibility wrapper.
 *
 * Kimble now has ONE balance: Kimble Credits. Cloud and AI usage is charged to
 * the same credits as builds, so "top up" always means the credits screen.
 * Existing call sites (backend enable, mobile builds, low-balance prompts)
 * keep their props; the minimum/reason hints are no longer needed because
 * there is nothing separate to fund.
 */
import { BillingSheet } from "@/components/BillingSheet";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess?: () => void;
  /** @deprecated single balance — kept so existing call sites compile. */
  minUsdCents?: number;
  /** @deprecated single balance — kept so existing call sites compile. */
  minReason?: string;
  /** @deprecated the credits screen handles upgrades itself. */
  onUpgrade?: () => void;
};

export function RuntimeTopupModal({ open, onOpenChange }: Props) {
  return <BillingSheet open={open} onOpenChange={onOpenChange} />;
}
