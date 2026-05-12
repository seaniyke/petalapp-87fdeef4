/**
 * Curated integration briefs — the "I trust this completely" tier.
 *
 * These bypass the network resolver entirely because we want pixel-perfect
 * SDK guidance for the most-requested services. Anything not in this map
 * falls through to npm registry lookup → AI synthesis.
 *
 * Each brief is < 1500 chars (prompt-cost discipline). Format:
 *   - install command
 *   - required env vars
 *   - minimal server-function-shaped example
 *   - one critical pitfall
 */

import type { ResolvedIntegration } from "./doc-resolver.server";

type CuratedEntry = Omit<ResolvedIntegration, "serviceSlug" | "source">;

export const CURATED_INTEGRATIONS: Record<string, CuratedEntry> = {
  openai: {
    displayName: "OpenAI",
    npmPackage: "openai",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    requiredSecrets: ["OPENAI_API_KEY"],
    promptBlock: `### Universal Integration: OpenAI
**STRONG PREFERENCE: use Lovable AI Gateway instead of calling OpenAI directly** — same model selection (openai/gpt-5*, openai/gpt-5.4*, openai/gpt-5.5), no key required from the user, billing handled. Only fall back to direct OpenAI if the user explicitly insists.
If the user does insist:
- Install: \`npm install openai\`
- Server-only secret: \`OPENAI_API_KEY\` (emit \`<lov-add-secret name="OPENAI_API_KEY" instructions="Create at platform.openai.com → API Keys" link="https://platform.openai.com/api-keys" />\` if missing)
- Use inside a server function:
  \`\`\`ts
  import OpenAI from "openai";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({ model: "gpt-4o", messages });
  \`\`\`
- Pitfall: NEVER instantiate \`OpenAI\` in client code — the key would leak. Always wrap in \`createServerFn\`.`,
  },

  anthropic: {
    displayName: "Anthropic Claude",
    npmPackage: "@anthropic-ai/sdk",
    docsUrl: "https://docs.anthropic.com/en/api",
    requiredSecrets: ["ANTHROPIC_API_KEY"],
    promptBlock: `### Universal Integration: Anthropic Claude
- Install: \`npm install @anthropic-ai/sdk\`
- Server-only secret: \`ANTHROPIC_API_KEY\` (get from console.anthropic.com)
- Server-function example:
  \`\`\`ts
  import Anthropic from "@anthropic-ai/sdk";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  \`\`\`
- Pitfall: \`max_tokens\` is REQUIRED (unlike OpenAI). Stream with \`client.messages.stream(...)\` for chat UIs.`,
  },

  twilio: {
    displayName: "Twilio",
    npmPackage: "twilio",
    docsUrl: "https://www.twilio.com/docs",
    requiredSecrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    promptBlock: `### Universal Integration: Twilio
- Install: \`npm install twilio\`
- Secrets (server only): \`TWILIO_ACCOUNT_SID\`, \`TWILIO_AUTH_TOKEN\`, \`TWILIO_PHONE_NUMBER\` (sender)
- Send SMS in a server function:
  \`\`\`ts
  import twilio from "twilio";
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
    body,
  });
  \`\`\`
- Webhook (incoming SMS / call status): create a \`/api/public/twilio-webhook\` route, verify the X-Twilio-Signature header with \`twilio.validateRequest\` BEFORE processing.
- Pitfall: WhatsApp uses \`whatsapp:+E164\` prefixes on both \`from\` and \`to\`.`,
  },

  mapbox: {
    displayName: "Mapbox",
    npmPackage: "mapbox-gl",
    docsUrl: "https://docs.mapbox.com/mapbox-gl-js",
    requiredSecrets: ["VITE_MAPBOX_TOKEN"],
    promptBlock: `### Universal Integration: Mapbox
- Install: \`npm install mapbox-gl\` and the CSS: \`import "mapbox-gl/dist/mapbox-gl.css"\`
- Public token (safe in browser, scope it to URL whitelist in dashboard): \`VITE_MAPBOX_TOKEN\`
- React component:
  \`\`\`tsx
  import mapboxgl from "mapbox-gl";
  mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN!;
  // inside useEffect with a ref div:
  const map = new mapboxgl.Map({ container: ref.current!, style: "mapbox://styles/mapbox/streets-v12", center: [lng, lat], zoom: 12 });
  return () => map.remove();
  \`\`\`
- Pitfall: must \`map.remove()\` on unmount or you leak WebGL contexts (browser hard-caps at ~16).`,
  },

  stripe: {
    displayName: "Stripe",
    npmPackage: "stripe",
    docsUrl: "https://stripe.com/docs/api",
    requiredSecrets: ["STRIPE_SECRET_KEY", "VITE_STRIPE_PUBLISHABLE_KEY"],
    promptBlock: `### Universal Integration: Stripe
**Petal already ships a managed Stripe integration** — strongly prefer running the Stripe install flow over hand-rolling. Suggest \`<lov-suggest-integration code="stripe" />\` first.
If hand-rolling:
- Install: \`npm install stripe @stripe/stripe-js\`
- Secrets: \`STRIPE_SECRET_KEY\` (server), \`VITE_STRIPE_PUBLISHABLE_KEY\` (client)
- Server checkout session:
  \`\`\`ts
  import Stripe from "stripe";
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const session = await stripe.checkout.sessions.create({ ... });
  \`\`\`
- Webhook at \`/api/public/stripe-webhook\` MUST verify with \`stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)\`.
- Pitfall: webhook handler must read the RAW body before JSON.parse — verification will fail otherwise.`,
  },

  resend: {
    displayName: "Resend",
    npmPackage: "resend",
    docsUrl: "https://resend.com/docs",
    requiredSecrets: ["RESEND_API_KEY"],
    promptBlock: `### Universal Integration: Resend
**Petal already ships a managed Resend integration** — suggest \`<lov-suggest-integration code="resend" />\` first.
If hand-rolling:
- Install: \`npm install resend\`
- Secret: \`RESEND_API_KEY\`
- \`\`\`ts
  import { Resend } from "resend";
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({ from, to, subject, html });
  \`\`\`
- Pitfall: \`from\` domain must be verified in the Resend dashboard, otherwise sends 403.`,
  },

  elevenlabs: {
    displayName: "ElevenLabs",
    npmPackage: "@elevenlabs/elevenlabs-js",
    docsUrl: "https://elevenlabs.io/docs/api-reference",
    requiredSecrets: ["ELEVENLABS_API_KEY"],
    promptBlock: `### Universal Integration: ElevenLabs (TTS / voice)
- Install: \`npm install @elevenlabs/elevenlabs-js\`
- Secret: \`ELEVENLABS_API_KEY\`
- TTS in a server function:
  \`\`\`ts
  import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
  const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  const audio = await client.textToSpeech.convert("21m00Tcm4TlvDq8ikWAM", { text, modelId: "eleven_turbo_v2_5" });
  // audio is a ReadableStream — pipe straight into Response or buffer for storage.
  \`\`\`
- Pitfall: voice IDs are per-account; default \`21m00Tcm4TlvDq8ikWAM\` (Rachel) works for everyone.`,
  },

  mux: {
    displayName: "Mux",
    npmPackage: "@mux/mux-node",
    docsUrl: "https://docs.mux.com",
    requiredSecrets: ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"],
    promptBlock: `### Universal Integration: Mux (video)
- Install: \`npm install @mux/mux-node @mux/mux-player-react\`
- Secrets: \`MUX_TOKEN_ID\`, \`MUX_TOKEN_SECRET\`
- Create direct upload (server):
  \`\`\`ts
  import Mux from "@mux/mux-node";
  const mux = new Mux({ tokenId: process.env.MUX_TOKEN_ID!, tokenSecret: process.env.MUX_TOKEN_SECRET! });
  const upload = await mux.video.uploads.create({ cors_origin: "*", new_asset_settings: { playback_policy: ["public"] } });
  \`\`\`
- Player (client): \`<MuxPlayer playbackId={asset.playback_ids[0].id} />\`
- Pitfall: webhooks for \`video.asset.ready\` are how you know the upload finished — don't poll.`,
  },

  livekit: {
    displayName: "LiveKit",
    npmPackage: "livekit-server-sdk",
    docsUrl: "https://docs.livekit.io",
    requiredSecrets: ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "VITE_LIVEKIT_URL"],
    promptBlock: `### Universal Integration: LiveKit (real-time audio/video)
- Install: \`npm install livekit-server-sdk @livekit/components-react livekit-client\` and \`import "@livekit/components-styles"\`
- Secrets: server \`LIVEKIT_API_KEY\` + \`LIVEKIT_API_SECRET\`; client \`VITE_LIVEKIT_URL\` (wss://)
- Token mint (server fn):
  \`\`\`ts
  import { AccessToken } from "livekit-server-sdk";
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: userId });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  return await at.toJwt();
  \`\`\`
- Client mounts \`<LiveKitRoom token={token} serverUrl={import.meta.env.VITE_LIVEKIT_URL}>...</LiveKitRoom>\`.`,
  },

  notion: {
    displayName: "Notion",
    npmPackage: "@notionhq/client",
    docsUrl: "https://developers.notion.com",
    requiredSecrets: ["NOTION_API_KEY"],
    promptBlock: `### Universal Integration: Notion
- Install: \`npm install @notionhq/client\`
- Secret: \`NOTION_API_KEY\` (internal integration token from notion.so/my-integrations)
- \`\`\`ts
  import { Client } from "@notionhq/client";
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const db = await notion.databases.query({ database_id });
  \`\`\`
- Pitfall: each Notion DB/page must be SHARED with the integration in the Notion UI or you get 404.`,
  },

  airtable: {
    displayName: "Airtable",
    npmPackage: "airtable",
    docsUrl: "https://airtable.com/developers/web/api/introduction",
    requiredSecrets: ["AIRTABLE_API_KEY", "AIRTABLE_BASE_ID"],
    promptBlock: `### Universal Integration: Airtable
- Install: \`npm install airtable\`
- Secrets: \`AIRTABLE_API_KEY\` (PAT), \`AIRTABLE_BASE_ID\`
- \`\`\`ts
  import Airtable from "airtable";
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID!);
  const records = await base("Table Name").select({ maxRecords: 100 }).all();
  \`\`\`
- Pitfall: PAT must have \`data.records:read\`/\`write\` scope AND access to the specific base.`,
  },

  cloudinary: {
    displayName: "Cloudinary",
    npmPackage: "cloudinary",
    docsUrl: "https://cloudinary.com/documentation",
    requiredSecrets: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    promptBlock: `### Universal Integration: Cloudinary
- Install: \`npm install cloudinary\`
- Secrets: \`CLOUDINARY_CLOUD_NAME\`, \`CLOUDINARY_API_KEY\`, \`CLOUDINARY_API_SECRET\`
- Signed upload preset (server):
  \`\`\`ts
  import { v2 as cloudinary } from "cloudinary";
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  const sig = cloudinary.utils.api_sign_request({ timestamp }, process.env.CLOUDINARY_API_SECRET!);
  \`\`\`
- Pitfall: prefer signed uploads (return signature from server) over unsigned to stop quota theft.`,
  },

  algolia: {
    displayName: "Algolia",
    npmPackage: "algoliasearch",
    docsUrl: "https://www.algolia.com/doc",
    requiredSecrets: ["VITE_ALGOLIA_APP_ID", "VITE_ALGOLIA_SEARCH_KEY", "ALGOLIA_ADMIN_KEY"],
    promptBlock: `### Universal Integration: Algolia
- Install: \`npm install algoliasearch\` (+ \`react-instantsearch\` for UI)
- Public (browser): \`VITE_ALGOLIA_APP_ID\`, \`VITE_ALGOLIA_SEARCH_KEY\` (search-only)
- Server-only: \`ALGOLIA_ADMIN_KEY\` (writes/index management)
- Browser:
  \`\`\`ts
  import algoliasearch from "algoliasearch/lite";
  const client = algoliasearch(import.meta.env.VITE_ALGOLIA_APP_ID, import.meta.env.VITE_ALGOLIA_SEARCH_KEY);
  \`\`\`
- Pitfall: NEVER ship the admin key to the browser — only the search key is safe.`,
  },

  pinecone: {
    displayName: "Pinecone (vector DB)",
    npmPackage: "@pinecone-database/pinecone",
    docsUrl: "https://docs.pinecone.io",
    requiredSecrets: ["PINECONE_API_KEY"],
    promptBlock: `### Universal Integration: Pinecone
- Install: \`npm install @pinecone-database/pinecone\`
- Secret: \`PINECONE_API_KEY\`
- \`\`\`ts
  import { Pinecone } from "@pinecone-database/pinecone";
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.index("my-index");
  await index.upsert([{ id, values: embedding, metadata }]);
  const results = await index.query({ topK: 5, vector: embedding, includeMetadata: true });
  \`\`\`
- Pitfall: index dimension must match your embedding model exactly (e.g. 1536 for text-embedding-3-small).`,
  },

  replicate: {
    displayName: "Replicate",
    npmPackage: "replicate",
    docsUrl: "https://replicate.com/docs",
    requiredSecrets: ["REPLICATE_API_TOKEN"],
    promptBlock: `### Universal Integration: Replicate (open-source model hosting)
- Install: \`npm install replicate\`
- Secret: \`REPLICATE_API_TOKEN\`
- \`\`\`ts
  import Replicate from "replicate";
  const r = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  const output = await r.run("owner/model:version-hash", { input: { prompt } });
  \`\`\`
- Pitfall: long-running models — use \`r.predictions.create\` + webhook over polling for production.`,
  },

  posthog: {
    displayName: "PostHog",
    npmPackage: "posthog-js",
    docsUrl: "https://posthog.com/docs",
    requiredSecrets: ["VITE_POSTHOG_KEY", "VITE_POSTHOG_HOST"],
    promptBlock: `### Universal Integration: PostHog (product analytics)
- Install: \`npm install posthog-js\`
- Public env: \`VITE_POSTHOG_KEY\`, \`VITE_POSTHOG_HOST\` (e.g. https://us.i.posthog.com)
- Boot once in the root layout:
  \`\`\`ts
  import posthog from "posthog-js";
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: import.meta.env.VITE_POSTHOG_HOST });
  \`\`\`
- Track: \`posthog.capture("event_name", { ...props })\`. Identify on login: \`posthog.identify(user.id, { email })\`.`,
  },

  sentry: {
    displayName: "Sentry",
    npmPackage: "@sentry/react",
    docsUrl: "https://docs.sentry.io",
    requiredSecrets: ["VITE_SENTRY_DSN"],
    promptBlock: `### Universal Integration: Sentry (error monitoring)
- Install: \`npm install @sentry/react\`
- Public env: \`VITE_SENTRY_DSN\`
- Boot in main entry:
  \`\`\`ts
  import * as Sentry from "@sentry/react";
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, tracesSampleRate: 0.1, replaysSessionSampleRate: 0.1 });
  \`\`\`
- Wrap routes/components with \`Sentry.ErrorBoundary\` for surfaced errors.`,
  },

  plaid: {
    displayName: "Plaid",
    npmPackage: "plaid",
    docsUrl: "https://plaid.com/docs",
    requiredSecrets: ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"],
    promptBlock: `### Universal Integration: Plaid (bank linking)
- Install: \`npm install plaid react-plaid-link\`
- Secrets (server): \`PLAID_CLIENT_ID\`, \`PLAID_SECRET\`, \`PLAID_ENV\` (\`sandbox\`|\`development\`|\`production\`)
- Create link token (server fn):
  \`\`\`ts
  import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
  const client = new PlaidApi(new Configuration({ basePath: PlaidEnvironments[process.env.PLAID_ENV ?? "sandbox"], baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID, "PLAID-SECRET": process.env.PLAID_SECRET } } }));
  const r = await client.linkTokenCreate({ user: { client_user_id: userId }, client_name: "Petal App", products: [Products.Transactions], country_codes: [CountryCode.Us], language: "en" });
  \`\`\`
- Client uses \`usePlaidLink({ token: linkToken, onSuccess })\` to open the modal.`,
  },

  shopify: {
    displayName: "Shopify",
    npmPackage: "@shopify/shopify-api",
    docsUrl: "https://shopify.dev/docs/api",
    requiredSecrets: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_ACCESS_TOKEN", "SHOPIFY_SHOP"],
    promptBlock: `### Universal Integration: Shopify
- Install: \`npm install @shopify/shopify-api\`
- Secrets: \`SHOPIFY_API_KEY\`, \`SHOPIFY_API_SECRET\`, \`SHOPIFY_ACCESS_TOKEN\` (custom app), \`SHOPIFY_SHOP\` (e.g. mystore.myshopify.com)
- For read-only product/order display, prefer the Storefront API (no OAuth needed) with a \`SHOPIFY_STOREFRONT_TOKEN\`.
- Pitfall: Admin API requires app installation + OAuth — for one-store apps use a Custom App with a static access token.`,
  },

  vercel_ai: {
    displayName: "Vercel AI SDK",
    npmPackage: "ai",
    docsUrl: "https://sdk.vercel.ai/docs",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: Vercel AI SDK
**Strong preference: use Lovable AI Gateway directly (it's already wired up)**. Vercel AI SDK is a wrapper — only install if the user explicitly wants \`useChat\`/\`useCompletion\` React hooks.
If they do:
- Install: \`npm install ai @ai-sdk/openai\`
- Server route streams via \`streamText({ model: openai("gpt-4o"), messages })\`
- Client: \`const { messages, input, handleSubmit } = useChat();\``,
  },

  langchain: {
    displayName: "LangChain",
    npmPackage: "langchain",
    docsUrl: "https://js.langchain.com/docs",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: LangChain
**Push back gently first**: LangChain JS adds significant abstraction; for most 2025 use cases the user is better off with raw Lovable AI gateway calls + a small chain-of-thought helper. Only proceed if they confirm.
- Install: \`npm install langchain @langchain/openai @langchain/core\`
- Use inside server functions only — many integrations need Node APIs.`,
  },

  hubspot: {
    displayName: "HubSpot",
    npmPackage: "@hubspot/api-client",
    docsUrl: "https://developers.hubspot.com/docs/api/overview",
    requiredSecrets: ["HUBSPOT_ACCESS_TOKEN"],
    promptBlock: `### Universal Integration: HubSpot
- Install: \`npm install @hubspot/api-client\`
- Secret: \`HUBSPOT_ACCESS_TOKEN\` (private app token)
- \`\`\`ts
  import { Client } from "@hubspot/api-client";
  const hubspot = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  await hubspot.crm.contacts.basicApi.create({ properties: { email, firstname, lastname } });
  \`\`\`
- Pitfall: private app must have CRM scopes enabled in the HubSpot UI.`,
  },

  discord: {
    displayName: "Discord (bot)",
    npmPackage: "discord.js",
    docsUrl: "https://discord.js.org",
    requiredSecrets: ["DISCORD_BOT_TOKEN"],
    promptBlock: `### Universal Integration: Discord bot
- Install: \`npm install discord.js\`
- Secret: \`DISCORD_BOT_TOKEN\`
- A persistent bot does NOT fit a serverless TanStack app. Two options:
  1. **Outbound only (recommended for Petal)**: send messages via REST — \`POST https://discord.com/api/v10/channels/<id>/messages\` with \`Authorization: Bot ${"<token>"}\`.
  2. **Full bot**: deploy a separate Node process (Railway, Fly, Render); Petal's app is the dashboard, the bot is a sidecar.
- Pitfall: don't try to keep \`client.login()\` open in a server function — it gets killed on every cold start.`,
  },

  mailgun: {
    displayName: "Mailgun",
    npmPackage: "mailgun.js",
    docsUrl: "https://documentation.mailgun.com",
    requiredSecrets: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"],
    promptBlock: `### Universal Integration: Mailgun
- Install: \`npm install mailgun.js form-data\`
- Secrets: \`MAILGUN_API_KEY\`, \`MAILGUN_DOMAIN\`
- \`\`\`ts
  import formData from "form-data";
  import Mailgun from "mailgun.js";
  const mg = new Mailgun(formData).client({ username: "api", key: process.env.MAILGUN_API_KEY! });
  await mg.messages.create(process.env.MAILGUN_DOMAIN!, { from, to, subject, html });
  \`\`\`
- Pitfall: EU accounts must pass \`url: "https://api.eu.mailgun.net"\`.`,
  },

  sendgrid: {
    displayName: "SendGrid",
    npmPackage: "@sendgrid/mail",
    docsUrl: "https://docs.sendgrid.com",
    requiredSecrets: ["SENDGRID_API_KEY"],
    promptBlock: `### Universal Integration: SendGrid
- Install: \`npm install @sendgrid/mail\`
- Secret: \`SENDGRID_API_KEY\`
- \`\`\`ts
  import sgMail from "@sendgrid/mail";
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  await sgMail.send({ from, to, subject, html });
  \`\`\`
- Pitfall: \`from\` must be a verified single sender or domain.`,
  },

  groq: {
    displayName: "Groq",
    npmPackage: "groq-sdk",
    docsUrl: "https://console.groq.com/docs",
    requiredSecrets: ["GROQ_API_KEY"],
    promptBlock: `### Universal Integration: Groq (LPU inference)
- Install: \`npm install groq-sdk\`
- Secret: \`GROQ_API_KEY\`
- \`\`\`ts
  import Groq from "groq-sdk";
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const r = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", messages });
  \`\`\`
- Strength: extremely fast token throughput. Pitfall: smaller context than frontier OpenAI/Anthropic models.`,
  },

  liveblocks: {
    displayName: "Liveblocks (multiplayer)",
    npmPackage: "@liveblocks/client",
    docsUrl: "https://liveblocks.io/docs",
    requiredSecrets: ["LIVEBLOCKS_SECRET_KEY"],
    promptBlock: `### Universal Integration: Liveblocks (real-time presence + collab)
- Install: \`npm install @liveblocks/client @liveblocks/react @liveblocks/react-ui\`
- Secret (server): \`LIVEBLOCKS_SECRET_KEY\` (used to mint room tokens)
- Auth endpoint (server fn): mint a room token with \`Liveblocks\` from \`@liveblocks/node\`.
- Client wraps tree in \`<RoomProvider id="room-id" initialPresence={{}}>\` and uses \`useOthers()\`, \`useStorage()\`.
- Pitfall: never expose the secret key to the browser — only the room token.`,
  },

  daily: {
    displayName: "Daily (video calls)",
    npmPackage: "@daily-co/daily-js",
    docsUrl: "https://docs.daily.co",
    requiredSecrets: ["DAILY_API_KEY"],
    promptBlock: `### Universal Integration: Daily.co
- Install: \`npm install @daily-co/daily-js @daily-co/daily-react\`
- Secret (server): \`DAILY_API_KEY\` to create rooms
- Server: \`POST https://api.daily.co/v1/rooms\` with \`Authorization: Bearer ${"<key>"}\` returns a \`url\`.
- Client: \`<DailyProvider url={roomUrl}><DailyVideo /></DailyProvider>\`.`,
  },

  cal: {
    displayName: "Cal.com",
    npmPackage: "@calcom/embed-react",
    docsUrl: "https://cal.com/docs",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: Cal.com (booking)
- Install: \`npm install @calcom/embed-react\`
- No API key needed for embeds — user pastes their Cal.com username/event slug.
- \`\`\`tsx
  import Cal from "@calcom/embed-react";
  <Cal calLink="username/30min" style={{ height: "100%", width: "100%" }} />
  \`\`\`
- For programmatic booking creation, use Cal API v2 with a personal access token (env: \`CAL_API_KEY\`).`,
  },
};
