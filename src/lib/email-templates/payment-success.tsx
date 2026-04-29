/**
 * "You're all set" receipt for any successful Paystack charge.
 *
 * Triggered ONCE per transaction by the verify route or the webhook
 * (whichever wins the grant race). Idempotency key is the paystack
 * reference so a verify+webhook double-fire only sends one email.
 *
 * Covers all purposes:
 *   - plan: subscription started/renewed
 *   - pack: design credits topped up
 *   - runtime_topup: cloud wallet topped up
 *   - addon: extra domain slot
 *   - domain_purchase: domain registered
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

type Purpose = "plan" | "pack" | "runtime_topup" | "addon" | "domain_purchase";

interface Props {
  purpose?: Purpose;
  itemLabel?: string;        // human label e.g. "Builder plan", "Starter pack", "$10 cloud top-up"
  amountDisplay?: string;    // already-formatted, e.g. "₦15,000" or "$10.00"
  reference?: string;
  paidAt?: string;           // ISO
  projectTitle?: string;     // for addons / domains
  hostname?: string;         // for domain_purchase
}

const headingByPurpose: Record<Purpose, string> = {
  plan: "Your plan is active",
  pack: "Credits added to your account",
  runtime_topup: "Your cloud wallet is topped up",
  addon: "Add-on unlocked",
  domain_purchase: "Your domain is on its way",
};

const introByPurpose: Record<Purpose, (p: Props) => string> = {
  plan: ({ itemLabel }) =>
    `Welcome to ${itemLabel ?? "your new plan"}. You can start building straight away — every project on your account picks up the new limits automatically.`,
  pack: ({ itemLabel }) =>
    `${itemLabel ?? "Your credits"} are now in your wallet, ready for your next builds.`,
  runtime_topup: ({ itemLabel }) =>
    `${itemLabel ?? "Your top-up"} has landed in your cloud wallet. Backend, AI usage and any other runtime costs will draw from it automatically.`,
  addon: ({ itemLabel, projectTitle }) =>
    `${itemLabel ?? "Your add-on"} is now active${projectTitle ? ` on ${projectTitle}` : ""}.`,
  domain_purchase: ({ hostname }) =>
    `We're registering ${hostname ?? "your new domain"} now. You'll get another note as soon as it's live — usually within a few minutes.`,
};

const ctaByPurpose: Record<Purpose, { label: string; href: string }> = {
  plan: { label: "Open Petal", href: SITE_URL },
  pack: { label: "Start a build", href: SITE_URL },
  runtime_topup: { label: "Open Petal", href: SITE_URL },
  addon: { label: "Open project", href: SITE_URL },
  domain_purchase: { label: "View domain", href: SITE_URL },
};

const PaymentSuccessEmail = (props: Props) => {
  const purpose: Purpose = (props.purpose ?? "pack") as Purpose;
  const heading = headingByPurpose[purpose] ?? "Payment received";
  const intro = (introByPurpose[purpose] ?? (() => "Thanks for your payment."))(props);
  const cta = ctaByPurpose[purpose] ?? ctaByPurpose.pack;

  const paidLine = props.paidAt
    ? new Date(props.paidAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <PetalEmailLayout
      preview={`${heading} — thanks from ${SITE_NAME}.`}
      heading={heading}
      cta={cta}
    >
      <Text style={text}>{intro}</Text>

      <Section style={receipt}>
        {props.itemLabel ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Item</span>
            {props.itemLabel}
          </Text>
        ) : null}
        {props.amountDisplay ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Amount</span>
            {props.amountDisplay}
          </Text>
        ) : null}
        {paidLine ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Paid</span>
            {paidLine}
          </Text>
        ) : null}
        {props.reference ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Reference</span>
            <span style={mono}>{props.reference}</span>
          </Text>
        ) : null}
      </Section>

      <Text style={muted}>This email is your receipt — keep it for your records.</Text>
    </PetalEmailLayout>
  );
};

export const template = {
  component: PaymentSuccessEmail,
  subject: (data: Record<string, any>) => {
    const purpose = (data?.purpose ?? "pack") as Purpose;
    const map: Record<Purpose, string> = {
      plan: `Your ${SITE_NAME} plan is active`,
      pack: `Credits added to your ${SITE_NAME} wallet`,
      runtime_topup: `Your ${SITE_NAME} cloud wallet is topped up`,
      addon: `Your ${SITE_NAME} add-on is active`,
      domain_purchase: `We're registering your domain`,
    };
    return map[purpose] ?? `Thanks for your payment to ${SITE_NAME}`;
  },
  displayName: "Payment success (receipt)",
  previewData: {
    purpose: "runtime_topup",
    itemLabel: "$10.00 cloud top-up",
    amountDisplay: "$10.00",
    reference: "petal_x9w2q4k7",
    paidAt: new Date().toISOString(),
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
