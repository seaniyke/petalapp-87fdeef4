/**
 * "Your managed backend renews in N days" — sent automatically by the
 * backend-slot-reminder cron when a slot is within 7 / 3 / 1 days of
 * expiry. One trigger event per recipient (the cron owns dedup via the
 * idempotency key).
 */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

const SITE_NAME = "Petal";

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
  renewUrl = "https://buildwithpetal.com",
}: Props) => {
  const heading =
    daysLeft <= 1
      ? "Your backend renews tomorrow"
      : `Your backend renews in ${daysLeft} days`;
  const expiresLine = expiresAt
    ? `Your current period ends on ${new Date(expiresAt).toLocaleDateString(undefined, { dateStyle: "long" })}.`
    : null;

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Heads up — your managed backend for {projectTitle} renews in {daysLeft}{" "}
        day{daysLeft === 1 ? "" : "s"}.
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{heading}</Heading>
          <Text style={text}>
            This is a friendly reminder that the managed backend on{" "}
            <strong>{projectTitle}</strong> is about to renew.
          </Text>
          {expiresLine ? <Text style={text}>{expiresLine}</Text> : null}
          <Text style={text}>
            If you'd like to keep your data online without interruption, you can
            renew now from the project's settings. If you don't renew, the
            backend will pause when the period ends — your tables and rows are
            preserved and will come back as soon as you renew.
          </Text>
          <Section style={btnWrap}>
            <Button href={renewUrl} style={btn}>
              Renew backend
            </Button>
          </Section>
          <Text style={footer}>— The {SITE_NAME} team</Text>
        </Container>
      </Body>
    </Html>
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
    renewUrl: "https://buildwithpetal.com",
  },
} satisfies TemplateEntry;

const main = {
  backgroundColor: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};
const container = {
  padding: "32px 28px",
  maxWidth: "560px",
};
const h1 = {
  fontSize: "22px",
  fontWeight: 700,
  color: "#1a1a1a",
  margin: "0 0 18px",
  lineHeight: 1.25,
};
const text = {
  fontSize: "15px",
  color: "#3f3f46",
  lineHeight: 1.55,
  margin: "0 0 14px",
};
const btnWrap = { margin: "24px 0 8px" };
const btn = {
  backgroundColor: "#e85d4a", // coral / primary
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: "8px",
  padding: "11px 20px",
  display: "inline-block",
};
const footer = {
  fontSize: "12px",
  color: "#9a9a9a",
  margin: "28px 0 0",
};
