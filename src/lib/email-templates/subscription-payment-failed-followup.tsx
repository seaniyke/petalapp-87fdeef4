/**
 * Follow-up nudge when a Paystack renewal charge has already failed and the
 * subscription is in `attention` state. Sent by the subscription-renewal-reminder
 * cron — capped at 3 nudges over ~14 days. Delivers the Paystack manage link
 * so the user can swap card without leaving email.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_NAME, SITE_URL, text, muted } from "./_layout";

interface Props {
  planName?: string;
  amountDisplay?: string;
  failedOn?: string;
  manageLink?: string;
}

const SubscriptionPaymentFailedFollowupEmail = ({
  planName = "your plan",
  amountDisplay,
  failedOn,
  manageLink = SITE_URL,
}: Props) => {
  const failedLine = failedOn
    ? `We last tried on ${new Date(failedOn).toLocaleDateString(undefined, { dateStyle: "long" })}.`
    : null;
  return (
    <PetalEmailLayout
      preview={`Update your card to keep ${planName} active on ${SITE_NAME}.`}
      heading="We couldn't charge your card"
      cta={{ label: "Update payment method", href: manageLink }}
    >
      <Text style={text}>
        Your last renewal charge for <strong>{planName}</strong>
        {amountDisplay ? ` (${amountDisplay})` : ""} didn't go through. Your
        plan is still on, but it will end at the end of this billing period
        unless we can charge a card.
      </Text>
      {failedLine ? <Text style={muted}>{failedLine}</Text> : null}
      <Text style={muted}>
        Tap the button above to add or update your card on {SITE_NAME}. It only
        takes a minute and you won't lose any credits or projects.
      </Text>
    </PetalEmailLayout>
  );
};

export const template = {
  component: SubscriptionPaymentFailedFollowupEmail,
  subject: (data: Record<string, any>) =>
    `Action needed: update your card for ${data?.planName ?? "your plan"}`,
  displayName: "Subscription payment failed (follow-up)",
  previewData: {
    planName: "Starter Pro plan",
    amountDisplay: "₦1,600",
    failedOn: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    manageLink: SITE_URL,
  },
} satisfies TemplateEntry;
