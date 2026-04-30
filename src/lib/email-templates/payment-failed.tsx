/**
 * "We couldn't take that payment" — friendly heads-up when a Paystack
 * charge ends in `failed` or `abandoned`. Sent ONCE per transaction.
 */
import * as React from "react";
import { Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import {
  PetalEmailLayout,
  SITE_NAME,
  SITE_URL,
  text,
  muted,
  detailRow,
  detailLabel,
} from "./_layout";

interface Props {
  itemLabel?: string;
  amountDisplay?: string;
  reference?: string;
  reason?: "failed" | "abandoned";
  /** Optional Paystack hosted card-update link, set for renewal failures. */
  manageLink?: string;
}

const PaymentFailedEmail = ({
  itemLabel,
  amountDisplay,
  reference,
  reason = "failed",
  manageLink,
}: Props) => {
  const isRenewal = Boolean(manageLink);
  const heading = isRenewal
    ? "Update your card to keep your plan"
    : reason === "abandoned"
      ? "Your payment didn't go through"
      : "We couldn't process your payment";
  const intro = isRenewal
    ? `We tried to renew${itemLabel ? ` your ${itemLabel}` : " your subscription"} and your bank declined the charge. Update your card to keep your plan active.`
    : reason === "abandoned"
      ? `Looks like the checkout was closed before it finished${itemLabel ? ` for ${itemLabel}` : ""}. No charge was made.`
      : `Your bank declined the charge${itemLabel ? ` for ${itemLabel}` : ""}. No funds left your account.`;

  return (
    <PetalEmailLayout
      preview={`${heading} — try again on ${SITE_NAME}.`}
      heading={heading}
      cta={{ label: isRenewal ? "Update card" : "Try again", href: manageLink ?? SITE_URL }}
    >
      <Text style={text}>{intro}</Text>
      <Text style={text}>
        {isRenewal
          ? "Tap the button above to add a new card on Paystack's secure page. Your plan stays paused until we can charge it."
          : "You can retry from the same place you started — your cart is still waiting."}
      </Text>

      {(itemLabel || amountDisplay || reference) && (
        <Section style={receipt}>
          {itemLabel ? (
            <Text style={detailRow}>
              <span style={detailLabel}>Item</span>
              {itemLabel}
            </Text>
          ) : null}
          {amountDisplay ? (
            <Text style={detailRow}>
              <span style={detailLabel}>Amount</span>
              {amountDisplay}
            </Text>
          ) : null}
          {reference ? (
            <Text style={detailRow}>
              <span style={detailLabel}>Reference</span>
              <span style={mono}>{reference}</span>
            </Text>
          ) : null}
        </Section>
      )}

      <Text style={muted}>
        If your card keeps getting declined, try a different card or method — and we're here if you need a hand.
      </Text>
    </PetalEmailLayout>
  );
};

export const template = {
  component: PaymentFailedEmail,
  subject: (data: Record<string, any>) =>
    data?.reason === "abandoned"
      ? `Your ${SITE_NAME} payment didn't go through`
      : `We couldn't process your ${SITE_NAME} payment`,
  displayName: "Payment failed / abandoned",
  previewData: {
    itemLabel: "Builder plan",
    amountDisplay: "₦15,000",
    reference: "petal_x9w2q4k7",
    reason: "failed",
  },
} satisfies TemplateEntry;

const receipt = {
  margin: "8px 0 24px",
  padding: "18px 20px",
  background: "#ffffff",
  border: "1px solid #f1e6db",
  borderRadius: "12px",
};

const mono = {
  fontFamily:
    "'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: "13px",
  color: "#3a2a20",
};
