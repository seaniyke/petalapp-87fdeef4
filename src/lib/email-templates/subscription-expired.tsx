/**
 * Sent once when a Paystack subscription's billing period has ended without a
 * successful renewal charge (or the user explicitly cancelled and the period
 * has now expired). Confirms the downgrade to Free and offers a one-tap renew.
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_NAME, SITE_URL, text, muted } from "./_layout";

interface Props {
  planName?: string;
  endedOn?: string;
  renewUrl?: string;
}

const SubscriptionExpiredEmail = ({
  planName = "your plan",
  endedOn,
  renewUrl = SITE_URL,
}: Props) => {
  const endedLine = endedOn
    ? `Your ${planName} ended on ${new Date(endedOn).toLocaleDateString(undefined, { dateStyle: "long" })}.`
    : `Your ${planName} has ended.`;
  return (
    <PetalEmailLayout
      preview={`${planName} ended — you're now on the Free plan.`}
      heading={`${planName} has ended`}
      cta={{ label: "Renew plan", href: renewUrl }}
    >
      <Text style={text}>{endedLine}</Text>
      <Text style={text}>
        You're back on the Free plan, so you'll still get your daily free credits
        on {SITE_NAME}. Your projects, prompts and history are all preserved.
      </Text>
      <Text style={muted}>
        Want your monthly credits back? Tap the button above to renew — you can
        also pick a different plan if your needs have changed.
      </Text>
    </PetalEmailLayout>
  );
};

export const template = {
  component: SubscriptionExpiredEmail,
  subject: (data: Record<string, any>) =>
    `${data?.planName ?? "Your plan"} has ended`,
  displayName: "Subscription expired",
  previewData: {
    planName: "Starter Pro plan",
    endedOn: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    renewUrl: SITE_URL,
  },
} satisfies TemplateEntry;
