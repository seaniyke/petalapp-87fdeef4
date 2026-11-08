/**
 * Owner notice: a partner account (Custard AI) dropped below its credit
 * alert. Sent once per dip by src/server/balance-alert.server.ts.
 */
import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props {
  partnerName?: string;
  balance?: string;
  threshold?: string;
}

const PartnerLowBalanceEmail = ({ partnerName = "Custard AI", balance = "—", threshold = "1,000" }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${partnerName} has ${balance} credits left`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Petal</Text>
        <Heading style={h1}>{`${partnerName} is below ${threshold} credits`}</Heading>
        <Text style={text}>
          {`${partnerName} has `}
          <strong>{`${balance} credits`}</strong>
          {` left, below your ${threshold}-credit alert.`}
        </Text>
        <Text style={text}>
          Their builds and Shared Cloud keep running until the balance reaches zero. After that, sign-in and data on
          their sites pause 48 hours later, while their pages stay online.
        </Text>
        <Text style={muted}>{`You'll get this again the next time the balance drops below ${threshold} after a top-up.`}</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: PartnerLowBalanceEmail,
  subject: (d: Record<string, any>) =>
    `${d.partnerName ?? "Custard AI"} is below ${d.threshold ?? "1,000"} credits (${d.balance ?? "?"} left)`,
  displayName: "Partner low balance",
  previewData: { partnerName: "Custard AI", balance: "987.45", threshold: "1,000" },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" };
const container = { padding: "28px 24px", maxWidth: "520px" };
const brand = { fontSize: "15px", fontWeight: 700, color: "#18181b", margin: "0 0 20px" };
const h1 = { fontSize: "22px", fontWeight: 700, color: "#18181b", margin: "0 0 16px" };
const text = { fontSize: "15px", lineHeight: "24px", color: "#27272a", margin: "0 0 14px" };
const muted = { fontSize: "13px", lineHeight: "20px", color: "#71717a", margin: "18px 0 0" };
