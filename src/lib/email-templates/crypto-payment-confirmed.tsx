/**
 * Crypto payment confirmed — the on-chain receipt.
 *
 * Sent once, right after a crypto submission clears on-chain and the wallet
 * has actually been credited (by the background verifier or an admin).
 * Includes what was bought, the transaction hash, and both timestamps.
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
  purpose?: "plan" | "pack" | "runtime_topup";
  itemLabel?: string;
  creditsLabel?: string | null;
  amountDisplay?: string;
  asset?: string;
  chain?: string;
  txHash?: string;
  reference?: string;
  submittedAt?: string;
  confirmedAt?: string;
}

const receipt = {
  background: "#faf7f5",
  borderRadius: "12px",
  padding: "16px 18px",
  margin: "18px 0",
};

const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
  wordBreak: "break-all" as const,
};

function when(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const headingByPurpose: Record<string, string> = {
  plan: "Your plan is active",
  pack: "Your credits have landed",
  runtime_topup: "Your Cloud + AI balance is topped up",
};

const CryptoPaymentConfirmedEmail = (props: Props) => {
  const purpose = props.purpose ?? "pack";
  const heading = headingByPurpose[purpose] ?? "Crypto payment confirmed";
  const submitted = when(props.submittedAt);
  const confirmed = when(props.confirmedAt);

  return (
    <PetalEmailLayout
      preview={`${heading} — your crypto payment cleared on-chain.`}
      heading={heading}
      cta={{ label: "Open billing", href: `${SITE_URL}/billing` }}
    >
      <Text style={text}>
        Your transfer cleared on-chain and {SITE_NAME} has credited your account
        automatically — nothing else for you to do.
      </Text>

      <Section style={receipt}>
        {props.itemLabel ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Item</span>
            {props.itemLabel}
          </Text>
        ) : null}
        {props.creditsLabel ? (
          <Text style={detailRow}>
            <span style={detailLabel}>You got</span>
            {props.creditsLabel}
          </Text>
        ) : null}
        {props.amountDisplay ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Amount</span>
            {props.amountDisplay}
          </Text>
        ) : null}
        {props.asset ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Paid with</span>
            {props.asset}
            {props.chain ? ` · ${props.chain}` : ""}
          </Text>
        ) : null}
        {props.txHash ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Transaction</span>
            <span style={mono}>{props.txHash}</span>
          </Text>
        ) : null}
        {submitted ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Submitted</span>
            {submitted}
          </Text>
        ) : null}
        {confirmed ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Confirmed</span>
            {confirmed}
          </Text>
        ) : null}
        {props.reference ? (
          <Text style={detailRow}>
            <span style={detailLabel}>Reference</span>
            <span style={mono}>{props.reference}</span>
          </Text>
        ) : null}
      </Section>

      <Text style={muted}>
        Keep this email as your receipt. You can also download a PDF invoice any
        time from your billing page.
      </Text>
    </PetalEmailLayout>
  );
};

export const template: TemplateEntry = {
  component: CryptoPaymentConfirmedEmail,
  displayName: "Crypto payment confirmed",
  subject: (data) =>
    `${headingByPurpose[String(data?.purpose ?? "pack")] ?? "Crypto payment confirmed"} — ${SITE_NAME}`,
  previewData: {
    purpose: "pack",
    itemLabel: "Starter pack",
    creditsLabel: "250 credits",
    amountDisplay: "$25.00",
    asset: "USDT",
    chain: "TRON (TRC-20)",
    txHash: "9f2c1d8a7b6e5f4c3d2a1b0e9f8d7c6b5a4938271605f4e3d2c1b0a99887766",
    reference: "crypto_9f2c1d8a7b6e5f4c",
    submittedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    confirmedAt: new Date().toISOString(),
  },
};

export default CryptoPaymentConfirmedEmail;
