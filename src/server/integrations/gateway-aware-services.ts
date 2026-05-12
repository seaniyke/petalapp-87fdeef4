/**
 * Layer H — Gateway-aware services map.
 *
 * Some third-party services Petal supports are best accessed through the
 * Lovable connector gateway (OAuth refresh, no raw token handling) instead of
 * the vendor SDK directly. The doc-resolver appends a hint to the prompt
 * block whenever a resolved integration matches one of these slugs so the
 * LLM defaults to the gateway pattern.
 */

export type GatewayHint = {
  /** Connector ID used by `standard_connectors--connect`. */
  connectorId: string;
  /** Display name for the connector picker. */
  displayName: string;
  /** Short reason why the gateway is preferred. */
  reason: string;
};

export const GATEWAY_AWARE_SERVICES: Record<string, GatewayHint> = {
  // Messaging
  slack: { connectorId: "slack", displayName: "Slack", reason: "OAuth + token refresh handled by the gateway." },
  telegram: { connectorId: "telegram", displayName: "Telegram", reason: "Bot token injected by the gateway, no raw token in code." },
  twilio: { connectorId: "twilio", displayName: "Twilio", reason: "Account credentials proxied via the gateway." },

  // Productivity / docs
  notion: { connectorId: "notion", displayName: "Notion", reason: "OAuth handled by the gateway." },
  airtable: { connectorId: "airtable", displayName: "Airtable", reason: "OAuth handled by the gateway." },
  asana: { connectorId: "asana", displayName: "Asana", reason: "OAuth handled by the gateway." },
  linear: { connectorId: "linear", displayName: "Linear", reason: "OAuth handled by the gateway." },
  hubspot: { connectorId: "hubspot", displayName: "HubSpot", reason: "OAuth handled by the gateway." },

  // Google Workspace
  "google-drive": { connectorId: "google_drive", displayName: "Google Drive", reason: "OAuth + token refresh handled by the gateway." },
  "google-sheets": { connectorId: "google_sheets", displayName: "Google Sheets", reason: "OAuth + token refresh handled by the gateway." },
  "google-docs": { connectorId: "google_docs", displayName: "Google Docs", reason: "OAuth + token refresh handled by the gateway." },
  "google-calendar": { connectorId: "google_calendar", displayName: "Google Calendar", reason: "OAuth + token refresh handled by the gateway." },
  gmail: { connectorId: "google_mail", displayName: "Gmail", reason: "OAuth + token refresh handled by the gateway." },

  // Microsoft
  "microsoft-outlook": { connectorId: "microsoft_outlook", displayName: "Microsoft Outlook", reason: "OAuth handled by the gateway." },
  "microsoft-teams": { connectorId: "microsoft_teams", displayName: "Microsoft Teams", reason: "OAuth handled by the gateway." },
  "microsoft-excel": { connectorId: "microsoft_excel", displayName: "Microsoft Excel", reason: "OAuth handled by the gateway." },

  // Email
  resend: { connectorId: "resend", displayName: "Resend", reason: "Key proxied via the gateway." },
  mailgun: { connectorId: "mailgun", displayName: "Mailgun", reason: "Key proxied via the gateway." },
  brevo: { connectorId: "brevo", displayName: "Brevo", reason: "Key proxied via the gateway." },

  // Storage
  "aws-s3": { connectorId: "aws_s3", displayName: "AWS S3", reason: "Credentials proxied via the gateway." },
};

export function gatewayHintFor(slug: string): GatewayHint | null {
  return GATEWAY_AWARE_SERVICES[slug] ?? null;
}

export function renderGatewayHint(slug: string, displayName: string): string {
  const hint = gatewayHintFor(slug);
  if (!hint) return "";
  return [
    "",
    `> **Prefer the Lovable connector gateway for ${displayName}.** ${hint.reason}`,
    `> 1. Have the user link the connector with \`standard_connectors--connect\` (connector_id: \`${hint.connectorId}\`).`,
    `> 2. From server code, POST to \`https://connector-gateway.lovable.dev/${hint.connectorId}/<endpoint>\` with headers \`Authorization: Bearer \${LOVABLE_API_KEY}\` and \`X-Connection-Api-Key: \${${hint.connectorId.toUpperCase()}_API_KEY}\`.`,
    `> 3. Do NOT install the vendor SDK or call the upstream API directly — the gateway handles auth refresh.`,
  ].join("\n");
}
