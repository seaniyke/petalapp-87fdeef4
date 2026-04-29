/**
 * Shared sleek brand layout for Petal transactional emails.
 *
 * Visual language matches the auth-email template:
 *   • cream container on white body
 *   • Georgia serif for the wordmark + heading
 *   • coral primary CTA (#e2674d)
 *   • subtle warm border, generous padding
 *
 * Keep it minimal — every template inherits the same container so all
 * transactional emails feel like one product.
 */
import * as React from "react";
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

export const SITE_NAME = "Petal";
export const SITE_URL = "https://buildwithpetal.com";

interface LayoutProps {
  preview: string;
  heading: string;
  children: React.ReactNode;
  cta?: { label: string; href: string };
  footnote?: string;
}

export function PetalEmailLayout({
  preview,
  heading,
  children,
  cta,
  footnote,
}: LayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>🌸 {SITE_NAME}</Text>
          <Heading style={h1}>{heading}</Heading>
          {children}
          {cta ? (
            <Section style={btnWrap}>
              <Button href={cta.href} style={btn}>
                {cta.label}
              </Button>
            </Section>
          ) : null}
          <Text style={footer}>
            {footnote ?? `If you have any questions, just reply to this email — we're here to help.`}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const text = {
  fontSize: "15px",
  color: "#3a2a20",
  lineHeight: 1.6,
  margin: "0 0 16px",
};

export const muted = {
  ...text,
  color: "#7a6a5e",
  fontSize: "14px",
};

export const detailRow = {
  fontSize: "14px",
  color: "#3a2a20",
  lineHeight: 1.55,
  margin: "0 0 6px",
};

export const detailLabel = {
  color: "#a8978a",
  display: "inline-block" as const,
  minWidth: "92px",
};

const main = {
  margin: 0,
  background: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  color: "#3a2a20",
};

const container = {
  maxWidth: "480px",
  margin: "40px auto",
  padding: "40px 32px",
  background: "#fffaf6",
  border: "1px solid #f1e6db",
  borderRadius: "16px",
};

const brand = {
  margin: "0 0 28px",
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: "20px",
  fontWeight: 600,
  color: "#2a1c14",
};

const h1 = {
  margin: "0 0 16px",
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: "26px",
  lineHeight: 1.2,
  color: "#2a1c14",
};

const btnWrap = { margin: "8px 0 24px" };

const btn = {
  display: "inline-block" as const,
  padding: "13px 24px",
  borderRadius: "12px",
  background: "#e2674d",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 500,
  textDecoration: "none",
};

const footer = {
  margin: "28px 0 0",
  paddingTop: "20px",
  borderTop: "1px solid #f1e6db",
  color: "#a8978a",
  fontSize: "13px",
  lineHeight: 1.5,
};
