/**
 * Owner notice: the live service can no longer reach the AI gateway, so new
 * builds and edits fail. Sent once per outage by ai-gateway-health.server.ts.
 */
import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface Props { kind?: string; reason?: string }

const ACTION: Record<string, string> = {
  key_not_registered: "The AI key on the live service is no longer accepted. Re-publish Petal (or rotate the AI key, then re-publish).",
  key_missing_or_invalid: "The AI key on the live service is missing or invalid. Re-publish Petal after checking the key.",
  credits: "The workspace has run out of AI credits. Top up to resume.",
  workspace_limit: "The workspace AI spending limit was reached. Raise it in workspace settings.",
  provider_denied: "The AI provider refused requests. Check the reason below.",
};

const AiGatewayDownEmail = ({ kind = "unknown", reason = "" }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Petal builds are failing: the AI service is refusing requests</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Petal</Text>
        <Heading style={h1}>New builds and edits are failing</Heading>
        <Text style={text}>{ACTION[kind] ?? "The AI service is refusing requests from the live service."}</Text>
        {reason ? <Text style={muted}>{`Reason from the AI service: ${reason}`}</Text> : null}
        <Text style={muted}>Nothing is charged for failed attempts. You'll hear from us again only after it recovers and fails again.</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: AiGatewayDownEmail,
  subject: () => "Petal: builds are failing — AI service is refusing requests",
  displayName: "AI gateway down",
  previewData: { kind: "key_not_registered", reason: "LOVABLE_API_KEY is not registered for this project" },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, Helvetica, sans-serif" };
const container = { padding: "28px 24px", maxWidth: "520px" };
const brand = { fontSize: "15px", fontWeight: 700, color: "#18181b", margin: "0 0 20px" };
const h1 = { fontSize: "22px", fontWeight: 700, color: "#18181b", margin: "0 0 16px" };
const text = { fontSize: "15px", lineHeight: "24px", color: "#27272a", margin: "0 0 14px" };
const muted = { fontSize: "13px", lineHeight: "20px", color: "#71717a", margin: "14px 0 0" };
