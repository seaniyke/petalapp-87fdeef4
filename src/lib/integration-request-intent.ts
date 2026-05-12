/**
 * Detects when the user wants Petal to integrate a third-party service that
 * isn't in our curated marketplace. Returns the service name(s) so the
 * generate pipeline can resolve docs on demand.
 *
 * Pure regex — fast, no model call. Conservative: if uncertain, return [].
 */

const VERBS =
  "(?:add|integrate|use|wire(?:[- ]up)?|connect|set[- ]?up|implement|hook[- ]?up|install)";
// Common service/SDK/API names. Lowercase, deduped, kept narrow to avoid false
// positives. Multi-word services use \\s.
const KNOWN = [
  "openai", "anthropic", "claude", "gemini", "groq", "mistral", "cohere", "perplexity",
  "twilio", "vonage", "plivo", "messagebird",
  "stripe", "paystack", "flutterwave", "lemonsqueezy", "paddle", "plaid",
  "resend", "sendgrid", "mailgun", "postmark", "loops",
  "mapbox", "google maps", "leaflet", "here maps",
  "elevenlabs", "deepgram", "assemblyai", "whisper",
  "mux", "cloudinary", "uploadthing", "bunny", "imagekit",
  "livekit", "daily", "agora", "vonage video",
  "liveblocks", "yjs", "partykit",
  "notion", "airtable", "linear", "asana", "trello", "clickup", "monday",
  "hubspot", "salesforce", "pipedrive", "intercom", "crisp",
  "discord", "slack", "telegram", "whatsapp",
  "shopify", "woocommerce", "bigcommerce", "medusa",
  "algolia", "meilisearch", "typesense", "elasticsearch",
  "pinecone", "weaviate", "qdrant", "chroma",
  "replicate", "huggingface", "fal", "runpod", "modal",
  "posthog", "mixpanel", "amplitude", "plausible", "umami", "fathom",
  "sentry", "datadog", "logrocket", "fullstory", "highlight",
  "vercel ai", "langchain", "llamaindex",
  "cal\\.?com", "calendly", "tldraw",
  "openai whisper", "openai realtime",
  "github", "gitlab", "linear",
  "firebase", "amplify", "appwrite",
  "auth0", "clerk", "kinde", "workos",
  "tinybird", "supabase",
  "x", "twitter", "instagram", "threads", "facebook", "meta", "linkedin",
  "tiktok", "youtube", "reddit", "bluesky", "mastodon",
  // Layer I — fintech / banking / BaaS
  "plaid", "teller", "mx", "unit", "increase", "dwolla", "wise",
  "modern treasury", "stripe issuing", "stripe treasury", "financial connections",
  "persona", "sumsub", "alloy", "veriff",
  // Layer I — crypto / web3
  "viem", "wagmi", "ethers", "walletconnect", "rainbowkit",
  "alchemy", "infura", "helius", "quicknode",
  "moonpay", "ramp", "transak",
  "moralis", "the graph", "coingecko", "coinbase", "coinmarketcap",
  // Layer K — Capacitor mobile plugins (matched as words; the resolver
  // will pull the @capacitor/<x> npm package brief automatically).
  "capacitor camera", "capacitor push", "capacitor geolocation",
  "capacitor share", "capacitor haptics", "capacitor preferences",
  "capacitor browser", "capacitor network", "capacitor filesystem",
  "capacitor status bar", "capacitor app", "capacitor splash screen",
  "revenuecat", "onesignal", "firebase messaging", "expo",
];

const SERVICE_PATTERN = new RegExp(
  `\\b${VERBS}\\b[\\s\\S]{0,40}?\\b(${KNOWN.join("|")})\\b`,
  "gi",
);
const STANDALONE_PATTERN = new RegExp(
  `\\b(${KNOWN.join("|")})\\b\\s+(?:api|sdk|integration|webhook|client)`,
  "gi",
);

export type IntegrationRequest = {
  name: string;
  /** Normalized comparison key (lowercase, no punctuation). */
  key: string;
};

/** Return up to N unique third-party services the user wants to add. */
export function detectIntegrationRequests(
  text: string,
  max = 3,
): IntegrationRequest[] {
  const out: IntegrationRequest[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const name = raw.trim().toLowerCase().replace(/\\?\./g, ".");
    const key = name.replace(/[^a-z0-9]+/g, "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name, key });
  };
  let m: RegExpExecArray | null;
  while ((m = SERVICE_PATTERN.exec(text)) && out.length < max) push(m[1]);
  while ((m = STANDALONE_PATTERN.exec(text)) && out.length < max) push(m[1]);
  return out;
}
