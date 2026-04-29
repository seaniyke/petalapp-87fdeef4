/**
 * "Your managed backend renews in N days" — sent automatically by the
 * backend-slot-reminder cron when a slot is within 7 / 3 / 1 days of
 * expiry. One trigger event per recipient (the cron owns dedup via the
 * idempotency key).
 */
import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { PetalEmailLayout, SITE_NAME, SITE_URL, text, muted } from "./_layout";

interface Props {
  daysLeft?: number;
  projectTitle?: string;
  expiresAt?: string;
  renewUrl?: string;
}

const BackendRenewalReminderEmail = ({
  daysLeft = 7,
  projectTitle = "your project",
  expiresAt,
  renewUrl = SITE_URL,
}: Props) => {
  const heading =
    daysLeft <= 1
      ? "Your backend renews tomorrow"
      : `Your backend renews in ${daysLeft} days`;
  const expiresLine = expiresAt
    ? `Your current period ends on ${new Date(expiresAt).toLocaleDateString(undefined, { dateStyle: "long" })}.`
    : null;

  return (
    <PetalEmailLayout
      preview={`Heads up — your managed backend for ${projectTitle} renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
      heading={heading}
      cta={{ label: "Renew backend", href: renewUrl }}
    >
      <Text style={text}>
        This is a friendly reminder that the managed backend on{" "}
        <strong>{projectTitle}</strong> is about to renew.
      </Text>
      {expiresLine ? <Text style={text}>{expiresLine}</Text> : null}
      <Text style={muted}>
        If you'd like to keep your data online without interruption, renew now from the project's settings. If you don't renew, the backend will pause when the period ends — your tables and rows are preserved and come back as soon as you renew.
      </Text>
    </PetalEmailLayout>
  );
};

export const template = {
  component: BackendRenewalReminderEmail,
  subject: (data: Record<string, any>) => {
    const days = Number(data?.daysLeft ?? 7);
    if (days <= 1) return `Your ${SITE_NAME} backend renews tomorrow`;
    return `Your ${SITE_NAME} backend renews in ${days} days`;
  },
  displayName: "Backend renewal reminder",
  previewData: {
    daysLeft: 3,
    projectTitle: "Acme dashboard",
    expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    renewUrl: SITE_URL,
  },
} satisfies TemplateEntry;
