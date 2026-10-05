/**
 * Connector Hub catalog — the one connector model (Phase 1, step 1).
 *
 * Browser-safe: no secrets, no server code. Existing marketplace
 * integrations (API-key installs) are mapped onto this model by `code`;
 * one-click (OAuth) connectors are listed with `availability: "setup_required"`
 * until their provider developer app credentials are configured.
 */
export type ConnectorCategory =
  | "payments"
  | "social"
  | "google"
  | "comms"
  | "analytics"
  | "ai"
  | "dev"
  | "app";

export type ConnectorAuth = "oauth" | "api_key" | "none";

export type ConnectorAvailability = "available" | "setup_required";

export type ConnectorDef = {
  id: string;
  name: string;
  category: ConnectorCategory;
  auth: ConnectorAuth;
  /** Marketplace integration code this connector installs through, if any. */
  integrationCode?: string;
  availability: ConnectorAvailability;
  blurb: string;
};

export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  payments: "Payments",
  social: "Social media",
  google: "Google",
  comms: "Messaging & email",
  analytics: "Analytics",
  ai: "AI",
  dev: "Developer",
  app: "App features",
};

export const CATEGORY_ORDER: ConnectorCategory[] = [
  "payments",
  "social",
  "google",
  "comms",
  "analytics",
  "ai",
  "dev",
  "app",
];

export const CONNECTORS: ConnectorDef[] = [
  // Payments
  { id: "stripe", name: "Stripe", category: "payments", auth: "api_key", integrationCode: "stripe", availability: "available", blurb: "Take card payments and subscriptions." },
  { id: "stripe_connect", name: "Stripe (one-click)", category: "payments", auth: "oauth", availability: "setup_required", blurb: "Connect your Stripe account with one click — no keys to copy." },
  { id: "paystack", name: "Paystack", category: "payments", auth: "api_key", integrationCode: "paystack", availability: "available", blurb: "Payments across Africa." },
  { id: "flutterwave", name: "Flutterwave", category: "payments", auth: "api_key", integrationCode: "flutterwave", availability: "available", blurb: "Cards, mobile money and bank transfers." },
  { id: "stripe_identity", name: "Stripe Identity", category: "payments", auth: "api_key", integrationCode: "stripe_identity", availability: "available", blurb: "Verify customer identity documents." },
  // Social
  { id: "meta", name: "Facebook & Instagram", category: "social", auth: "oauth", availability: "setup_required", blurb: "Post to your Page and Instagram account." },
  { id: "x", name: "X", category: "social", auth: "oauth", availability: "setup_required", blurb: "Schedule and publish posts." },
  { id: "linkedin", name: "LinkedIn", category: "social", auth: "oauth", availability: "setup_required", blurb: "Share updates from your company page." },
  { id: "tiktok", name: "TikTok", category: "social", auth: "oauth", availability: "setup_required", blurb: "Publish short videos." },
  // Google
  { id: "google_business", name: "Google Business Profile", category: "google", auth: "oauth", availability: "setup_required", blurb: "Keep your Maps listing up to date." },
  { id: "google_analytics", name: "Google Analytics", category: "google", auth: "oauth", availability: "setup_required", blurb: "See who visits your site." },
  { id: "google_search_console", name: "Search Console", category: "google", auth: "oauth", availability: "setup_required", blurb: "Track how people find you on Google." },
  { id: "google_calendar", name: "Google Calendar", category: "google", auth: "oauth", availability: "setup_required", blurb: "Sync bookings to your calendar." },
  // Comms
  { id: "resend", name: "Email (Resend)", category: "comms", auth: "api_key", integrationCode: "resend", availability: "available", blurb: "Send emails from your app." },
  { id: "whatsapp", name: "WhatsApp Business", category: "comms", auth: "oauth", availability: "setup_required", blurb: "Message customers on WhatsApp." },
  { id: "slack", name: "Slack", category: "comms", auth: "oauth", availability: "setup_required", blurb: "Get alerts in your team's Slack." },
  // Analytics
  { id: "plausible", name: "Plausible", category: "analytics", auth: "api_key", integrationCode: "plausible", availability: "available", blurb: "Simple, private visitor stats." },
  { id: "posthog", name: "PostHog", category: "analytics", auth: "api_key", integrationCode: "posthog", availability: "available", blurb: "Product analytics and funnels." },
  // AI
  { id: "openai", name: "OpenAI", category: "ai", auth: "api_key", integrationCode: "openai", availability: "available", blurb: "Use your own OpenAI key in the app." },
  // Dev
  { id: "github", name: "GitHub", category: "dev", auth: "oauth", availability: "setup_required", blurb: "Sync your code to a repository." },
  // App features
  { id: "pwa", name: "Installable app", category: "app", auth: "none", integrationCode: "pwa", availability: "available", blurb: "Let visitors add your app to their home screen." },
];

export type ConnectorStatus = "connected" | "available" | "setup_required";

export function connectorStatus(
  c: ConnectorDef,
  installedCodes: ReadonlySet<string>,
): ConnectorStatus {
  if (c.integrationCode && installedCodes.has(c.integrationCode)) return "connected";
  return c.availability === "available" ? "available" : "setup_required";
}

export function groupByCategory(list: ConnectorDef[] = CONNECTORS) {
  return CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: list.filter((c) => c.category === cat),
  })).filter((g) => g.items.length > 0);
}
