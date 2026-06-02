/**
 * Sent T-7 / T-3 / T-1 days before a Paystack subscription renews. Gives the
 * user a chance to update card / cancel before the charge attempt.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_NAME, SITE_URL, text, muted } from "./_layout";

interface Props {
  planName?: string;
  amountDisplay?: string;
  renewsOn?: string;
  daysLeft?: number;
  manageLink?: string;
}

const SubscriptionRenewalReminderEmail = ({
  planName = "your plan",
  amountDisplay,
  renewsOn,
  daysLeft = 7,
  manageLink = SITE_URL,
}: Props) => {
  const heading =
    daysLeft <= 1
      ? `Your ${planName} renews tomorrow`
      : `Your ${planName} renews in ${daysLeft} days`;
  const dateLine = renewsOn
    ? `Renewal date: ${new Date(renewsOn).toLocaleDateString(undefined, { dateStyle: "long" })}.`
    : null;
  return (
    <PetalEmailLayout
      preview={`Heads up — ${planName} renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
      heading={heading}
      cta={{ label: "Manage subscription", href: manageLink }}
    >
      <Text style={text}>
        Just a friendly heads-up: your <strong>{planName}</strong> on {SITE_NAME} is
        about to renew{amountDisplay ? ` for ${amountDisplay}` : ""}.
      </Text>
      {dateLine ? <Text style={text}>{dateLine}</Text> : null}
      <Text style={muted}>
        If your card has changed or you'd like to cancel before renewal, use the
        button above. No action needed if everything looks good — your plan will
        keep going without interruption.
      </Text>
    </PetalEmailLayout>
  );
};

export const template = {
  component: SubscriptionRenewalReminderEmail,
  subject: (data: Record<string, any>) => {
    const days = Number(data?.daysLeft ?? 7);
    const plan = String(data?.planName ?? "your plan");
    if (days <= 1) return `${plan} renews tomorrow`;
    return `${plan} renews in ${days} days`;
  },
  displayName: "Subscription renewal reminder",
  previewData: {
    planName: "Starter Pro plan",
    amountDisplay: "₦1,600",
    renewsOn: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    daysLeft: 3,
    manageLink: SITE_URL,
  },
} satisfies TemplateEntry;
