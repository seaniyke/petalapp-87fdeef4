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

  /* ─────────────── Messaging / comms ─────────────── */

  whatsapp: {
    displayName: "WhatsApp Cloud API",
    npmPackage: null,
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    requiredSecrets: ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
    promptBlock: `### Universal Integration: WhatsApp (Meta Cloud API)
Use the official Meta Cloud API directly via fetch — no SDK needed.
- Server secrets: \`WHATSAPP_TOKEN\` (long-lived system-user token from Meta Business), \`WHATSAPP_PHONE_NUMBER_ID\`, optionally \`WHATSAPP_VERIFY_TOKEN\` for the webhook.
- Send a text message (server function only):
  \`\`\`ts
  await fetch(\`https://graph.facebook.com/v21.0/\${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${process.env.WHATSAPP_TOKEN}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  \`\`\`
- Webhooks (incoming messages): create a route at \`src/routes/api/public/whatsapp/webhook.ts\`. Handle GET for the \`hub.challenge\` verification, POST for incoming messages. Respond 200 fast (<5s) and process async.
- Pitfalls: outside a 24-hour customer-service window you can ONLY send pre-approved message templates. Free-form text fails silently. New numbers are rate-limited until quality rating is established.`,
  },

  telegram: {
    displayName: "Telegram Bot API",
    npmPackage: null,
    docsUrl: "https://core.telegram.org/bots/api",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: Telegram Bot
**Prefer the Lovable connector gateway.** Do NOT ask the user for a bot token directly — link the Telegram connector instead and call through the gateway. Server-side env vars become \`LOVABLE_API_KEY\` and \`TELEGRAM_API_KEY\` (the connection key, NOT the raw bot token).
- Send a message:
  \`\`\`ts
  await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.LOVABLE_API_KEY}\`,
      "X-Connection-Api-Key": process.env.TELEGRAM_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
  });
  \`\`\`
- Receive messages: create \`src/routes/api/public/telegram/webhook.ts\`, derive a secret_token via \`sha256("telegram-webhook:" + TELEGRAM_API_KEY).base64url\`, validate the \`X-Telegram-Bot-Api-Secret-Token\` header, persist the update by \`update_id\` (idempotent). Register with \`setWebhook\` through the gateway.
- Pitfall: never call \`api.telegram.org\` directly — the gateway holds the token. Telegram retries failed deliveries, so dedupe on \`update_id\`.`,
  },

  slack: {
    displayName: "Slack Web API",
    npmPackage: null,
    docsUrl: "https://api.slack.com/web",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: Slack
**Prefer the Lovable connector gateway.** Link the Slack connector; env becomes \`LOVABLE_API_KEY\` + \`SLACK_API_KEY\`. Do NOT use \`@slack/web-api\` — call the gateway directly.
- Post a message:
  \`\`\`ts
  await fetch("https://connector-gateway.lovable.dev/slack/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.LOVABLE_API_KEY}\`,
      "X-Connection-Api-Key": process.env.SLACK_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text, blocks }),
  });
  \`\`\`
- Slash commands & events: public webhook at \`src/routes/api/public/slack/events.ts\` — verify the \`X-Slack-Signature\` HMAC, handle the \`url_verification\` challenge, ack within 3s.
- Pitfall: missing scopes are the #1 failure. If a call returns \`{ ok: false, error: "missing_scope" }\`, ask the user to reconnect with the needed scope (e.g. \`chat:write\`).`,
  },

  vonage: {
    displayName: "Vonage (SMS / Voice)",
    npmPackage: "@vonage/server-sdk",
    docsUrl: "https://developer.vonage.com",
    requiredSecrets: ["VONAGE_API_KEY", "VONAGE_API_SECRET"],
    promptBlock: `### Universal Integration: Vonage
- Install: \`npm install @vonage/server-sdk\`
- Secrets: \`VONAGE_API_KEY\`, \`VONAGE_API_SECRET\` (and \`VONAGE_FROM\` for sender ID).
- Send SMS in a server function:
  \`\`\`ts
  import { Vonage } from "@vonage/server-sdk";
  const v = new Vonage({ apiKey: process.env.VONAGE_API_KEY!, apiSecret: process.env.VONAGE_API_SECRET! });
  await v.sms.send({ to, from: process.env.VONAGE_FROM!, text });
  \`\`\`
- Pitfall: alphanumeric sender IDs are blocked in the US — use a long code or toll-free number there.`,
  },

  /* ─────────────── Social — publish & read ─────────────── */

  twitter: {
    displayName: "X (Twitter) API v2",
    npmPackage: "twitter-api-v2",
    docsUrl: "https://docs.x.com/x-api",
    requiredSecrets: ["TWITTER_BEARER_TOKEN"],
    promptBlock: `### Universal Integration: X (Twitter) API v2
- Install: \`npm install twitter-api-v2\`
- For READ-ONLY (search tweets, read user timelines as the developer): \`TWITTER_BEARER_TOKEN\`.
- For POSTING on a user's behalf: this REQUIRES per-user OAuth 2.0 PKCE — the user authorises your app, you store their access + refresh tokens. Do NOT just use a bearer token for posting; that fails with 403.
  - App credentials: \`TWITTER_CLIENT_ID\`, \`TWITTER_CLIENT_SECRET\`. Store per-user tokens in a \`social_tokens\` table with RLS.
- Post a tweet (with a per-user access token):
  \`\`\`ts
  import { TwitterApi } from "twitter-api-v2";
  const client = new TwitterApi(userAccessToken);
  await client.v2.tweet({ text });
  \`\`\`
- Pitfall: Free tier of the X API is heavily rate-limited (1500 posts/month/app, no search). Confirm the user has the right tier before promising features.`,
  },

  x: {
    displayName: "X (Twitter) API v2",
    npmPackage: "twitter-api-v2",
    docsUrl: "https://docs.x.com/x-api",
    requiredSecrets: ["TWITTER_BEARER_TOKEN"],
    promptBlock: `### Universal Integration: X (formerly Twitter) — see "twitter" brief.
Same SDK (\`twitter-api-v2\`), same OAuth 2.0 PKCE for posting on behalf of users, same Free-tier limits.`,
  },

  linkedin: {
    displayName: "LinkedIn API",
    npmPackage: null,
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/",
    requiredSecrets: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    promptBlock: `### Universal Integration: LinkedIn
LinkedIn has NO general-purpose SDK — call REST directly. ALL posting requires per-user OAuth 2.0 (member-context); there is no app-level posting.
- App credentials: \`LINKEDIN_CLIENT_ID\`, \`LINKEDIN_CLIENT_SECRET\`. Required scopes for posting: \`w_member_social\`, \`openid\`, \`profile\`.
- Post a UGC share (with the user's access token):
  \`\`\`ts
  await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: { Authorization: \`Bearer \${userAccessToken}\`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
    body: JSON.stringify({
      author: \`urn:li:person:\${userUrn}\`,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text }, shareMediaCategory: "NONE" } },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  \`\`\`
- Pitfall: the v2 \`ugcPosts\` endpoint is being deprecated — newer apps should use \`/rest/posts\` with the Versioned API. Always check current doc version. Apps need LinkedIn approval to access most products beyond Sign-In.`,
  },

  instagram: {
    displayName: "Instagram Graph API",
    npmPackage: null,
    docsUrl: "https://developers.facebook.com/docs/instagram-platform",
    requiredSecrets: ["INSTAGRAM_ACCESS_TOKEN"],
    promptBlock: `### Universal Integration: Instagram Graph API
Posting requires an Instagram Business or Creator account linked to a Facebook Page, plus Meta App Review for production. Two flows:

**(A) Instagram Login API** (newer, simpler — post to your own IG account):
- Per-user OAuth via Instagram Login. Token + IG User ID stored per user.
- Publish a photo (two-step):
  \`\`\`ts
  // 1) Create container
  const c = await fetch(\`https://graph.instagram.com/v21.0/\${igUserId}/media?image_url=\${encodeURIComponent(url)}&caption=\${encodeURIComponent(caption)}&access_token=\${token}\`, { method: "POST" });
  const { id } = await c.json();
  // 2) Publish container
  await fetch(\`https://graph.instagram.com/v21.0/\${igUserId}/media_publish?creation_id=\${id}&access_token=\${token}\`, { method: "POST" });
  \`\`\`

**(B) Facebook Graph (legacy)**: post via the connected FB Page; uses \`graph.facebook.com\` and a Page access token.

- Pitfall: image URLs must be PUBLIC HTTPS and stay reachable for ~1 minute. Stories / Reels have separate container types and stricter rules. No posting to personal accounts — Business/Creator only.`,
  },

  threads: {
    displayName: "Threads API",
    npmPackage: null,
    docsUrl: "https://developers.facebook.com/docs/threads",
    requiredSecrets: ["THREADS_ACCESS_TOKEN"],
    promptBlock: `### Universal Integration: Threads (Meta) API
- Per-user OAuth (Threads-specific scopes: \`threads_basic\`, \`threads_content_publish\`).
- Publishing is a 2-step container flow like Instagram:
  \`\`\`ts
  const c = await fetch(\`https://graph.threads.net/v1.0/\${userId}/threads?media_type=TEXT&text=\${encodeURIComponent(text)}&access_token=\${token}\`, { method: "POST" });
  const { id } = await c.json();
  await fetch(\`https://graph.threads.net/v1.0/\${userId}/threads_publish?creation_id=\${id}&access_token=\${token}\`, { method: "POST" });
  \`\`\`
- Pitfall: Threads is rate-limited to 250 posts / 24h per user. Replies use \`reply_to_id\` on the container.`,
  },

  facebook: {
    displayName: "Facebook Graph API",
    npmPackage: null,
    docsUrl: "https://developers.facebook.com/docs/graph-api",
    requiredSecrets: ["FACEBOOK_ACCESS_TOKEN"],
    promptBlock: `### Universal Integration: Facebook (Meta Graph API)
- Per-user OAuth via Facebook Login; for posting you need a Page Access Token (not user token).
- Post to a Page: \`POST https://graph.facebook.com/v21.0/{page-id}/feed\` with \`{ message, access_token }\`.
- Pitfall: most permissions (e.g. \`pages_manage_posts\`) require Meta App Review before production. Personal-profile posting was removed in 2018.`,
  },

  tiktok: {
    displayName: "TikTok Content Posting API",
    npmPackage: null,
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    requiredSecrets: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    promptBlock: `### Universal Integration: TikTok Content Posting API
- Per-user OAuth 2.0 with scopes \`video.upload\` and/or \`video.publish\`.
- Publishing flow: (1) init upload to get an \`upload_url\` and \`publish_id\`; (2) PUT the video bytes to that URL; (3) poll \`/v2/post/publish/status/fetch/\` until \`PUBLISH_COMPLETE\`.
- Sandbox mode posts to "Only Me" until your app is approved.
- Pitfall: app review required for any production posting. Direct Post requires extra approval beyond Inbox upload.`,
  },

  youtube: {
    displayName: "YouTube Data API v3",
    npmPackage: "googleapis",
    docsUrl: "https://developers.google.com/youtube/v3",
    requiredSecrets: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    promptBlock: `### Universal Integration: YouTube Data API v3
- Install: \`npm install googleapis\`
- READ-ONLY public data (search videos, fetch channel stats): use an API key, no OAuth.
- WRITE (upload, update playlists, manage channel): per-user OAuth 2.0 with scope \`https://www.googleapis.com/auth/youtube.upload\` or \`youtube\`.
- Upload:
  \`\`\`ts
  import { google } from "googleapis";
  const auth = new google.auth.OAuth2(...); auth.setCredentials({ access_token, refresh_token });
  const yt = google.youtube({ version: "v3", auth });
  await yt.videos.insert({ part: ["snippet","status"], requestBody: { snippet: { title, description }, status: { privacyStatus: "private" } }, media: { body: stream } });
  \`\`\`
- Pitfall: default daily quota is 10,000 units; an \`upload\` costs 1,600 units. Search is 100/query.`,
  },

  reddit: {
    displayName: "Reddit API",
    npmPackage: "snoowrap",
    docsUrl: "https://www.reddit.com/dev/api",
    requiredSecrets: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"],
    promptBlock: `### Universal Integration: Reddit
- Install: \`npm install snoowrap\` (or call REST directly — both work).
- For app-as-user (your own bot account): script-app credentials with username/password OAuth.
- For posting on a user's behalf: per-user OAuth 2.0 with scopes \`submit\`, \`identity\`, \`read\`.
- \`\`\`ts
  import Snoowrap from "snoowrap";
  const r = new Snoowrap({ userAgent: "petal-app/1.0", clientId, clientSecret, username, password });
  await r.getSubreddit("test").submitSelfpost({ title, text });
  \`\`\`
- Pitfall: Reddit blocks non-descriptive User-Agents. Use a unique \`platform-name/version by /u/your-username\` UA or you'll get 429 immediately.`,
  },

  bluesky: {
    displayName: "Bluesky (AT Protocol)",
    npmPackage: "@atproto/api",
    docsUrl: "https://docs.bsky.app",
    requiredSecrets: ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"],
    promptBlock: `### Universal Integration: Bluesky / AT Protocol
- Install: \`npm install @atproto/api\`
- Auth uses an **app password** (created at bsky.app → Settings → App Passwords), NOT the account password.
- Post:
  \`\`\`ts
  import { BskyAgent } from "@atproto/api";
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: process.env.BLUESKY_HANDLE!, password: process.env.BLUESKY_APP_PASSWORD! });
  await agent.post({ text, createdAt: new Date().toISOString() });
  \`\`\`
- For multi-user apps, use OAuth (newer) instead of app passwords. Posts and likes are public records on the user's PDS.`,
  },

  mastodon: {
    displayName: "Mastodon API",
    npmPackage: "masto",
    docsUrl: "https://docs.joinmastodon.org/api/",
    requiredSecrets: ["MASTODON_INSTANCE_URL", "MASTODON_ACCESS_TOKEN"],
    promptBlock: `### Universal Integration: Mastodon
- Install: \`npm install masto\`
- Per-instance auth: each user picks their instance (e.g. \`mastodon.social\`). Register an app on that instance to get \`client_id\` + \`client_secret\`, then OAuth users to get an access token.
- Post:
  \`\`\`ts
  import { createRestAPIClient } from "masto";
  const m = createRestAPIClient({ url: instanceUrl, accessToken });
  await m.v1.statuses.create({ status: text, visibility: "public" });
  \`\`\`
- Pitfall: instances are sovereign — rate limits and permissible content vary. Always store \`instance_url\` alongside the user's access token.`,
  },

  /* ─────────────── Auth providers ─────────────── */

  clerk: {
    displayName: "Clerk",
    npmPackage: "@clerk/clerk-react",
    docsUrl: "https://clerk.com/docs",
    requiredSecrets: ["CLERK_SECRET_KEY"],
    promptBlock: `### Universal Integration: Clerk
Note: this project uses Lovable Cloud (Supabase) auth by default. Only swap to Clerk if the user explicitly asks (e.g. needs Clerk's organisations/MFA UI).
- Install: \`npm install @clerk/clerk-react\` (frontend) + \`@clerk/backend\` (server fns).
- Public env: \`VITE_CLERK_PUBLISHABLE_KEY\`. Server secret: \`CLERK_SECRET_KEY\`.
- Wrap the app in \`<ClerkProvider publishableKey={...}>\`. Use \`<SignedIn>\`, \`<SignedOut>\`, \`<UserButton />\`.
- Verify session in a server fn: \`import { verifyToken } from "@clerk/backend"\`.
- Pitfall: Clerk and Supabase auth do NOT share sessions. If you need Clerk users to write to a Supabase RLS-protected table, mint a Supabase JWT from a Clerk session in a server fn.`,
  },

  auth0: {
    displayName: "Auth0",
    npmPackage: "@auth0/auth0-react",
    docsUrl: "https://auth0.com/docs",
    requiredSecrets: ["AUTH0_CLIENT_SECRET"],
    promptBlock: `### Universal Integration: Auth0
- Install: \`npm install @auth0/auth0-react\`
- Public env: \`VITE_AUTH0_DOMAIN\`, \`VITE_AUTH0_CLIENT_ID\`. Server: \`AUTH0_CLIENT_SECRET\`.
- Wrap in \`<Auth0Provider domain={...} clientId={...} authorizationParams={{ redirect_uri: window.location.origin }}>\`. Use \`useAuth0()\` for \`loginWithRedirect\`, \`logout\`, \`user\`.
- Server-side: verify the access token with \`jose\` against the Auth0 JWKS at \`https://{domain}/.well-known/jwks.json\`.
- Pitfall: callback URL must match EXACTLY what's configured in the Auth0 dashboard (including trailing slash). Localhost and production are separate entries.`,
  },

  workos: {
    displayName: "WorkOS",
    npmPackage: "@workos-inc/node",
    docsUrl: "https://workos.com/docs",
    requiredSecrets: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID"],
    promptBlock: `### Universal Integration: WorkOS (enterprise SSO + AuthKit)
- Install: \`npm install @workos-inc/node @workos-inc/authkit-react\`
- Server secret: \`WORKOS_API_KEY\`. Public: \`VITE_WORKOS_CLIENT_ID\`.
- AuthKit hosted login: redirect to \`workos.getAuthorizationUrl({ provider: "authkit", clientId, redirectUri })\`, exchange the code in a server fn with \`workos.userManagement.authenticateWithCode\`.
- Pitfall: SSO connections are configured per-organisation in the WorkOS dashboard — your app sees them via \`organization_id\`, not the SSO provider directly.`,
  },

  kinde: {
    displayName: "Kinde",
    npmPackage: "@kinde-oss/kinde-auth-react",
    docsUrl: "https://kinde.com/docs",
    requiredSecrets: ["KINDE_CLIENT_SECRET"],
    promptBlock: `### Universal Integration: Kinde
- Install: \`npm install @kinde-oss/kinde-auth-react\`
- Public: \`VITE_KINDE_DOMAIN\`, \`VITE_KINDE_CLIENT_ID\`, \`VITE_KINDE_REDIRECT_URI\`. Server: \`KINDE_CLIENT_SECRET\`.
- Wrap the tree in \`<KindeProvider clientId={...} domain={...} redirectUri={...} logoutUri={...}>\`; use \`useKindeAuth()\`.
- Server-side: verify access tokens against the Kinde JWKS.
- Pitfall: feature flags and permissions live on the Kinde token — read them from the access-token claims, not the user object.`,
  },

  /* ─────────────── Search ─────────────── */


  meilisearch: {
    displayName: "Meilisearch",
    npmPackage: "meilisearch",
    docsUrl: "https://www.meilisearch.com/docs",
    requiredSecrets: ["MEILISEARCH_HOST", "MEILISEARCH_MASTER_KEY"],
    promptBlock: `### Universal Integration: Meilisearch
- Install: \`npm install meilisearch\`
- Server: \`MEILISEARCH_HOST\`, \`MEILISEARCH_MASTER_KEY\`. Generate scoped tenant tokens for browser use; never ship the master key.
- \`\`\`ts
  import { MeiliSearch } from "meilisearch";
  const client = new MeiliSearch({ host: process.env.MEILISEARCH_HOST!, apiKey: process.env.MEILISEARCH_MASTER_KEY! });
  await client.index("movies").addDocuments([{ id: 1, title: "Dune" }]);
  \`\`\`
- Pitfall: searchable / filterable / sortable attributes must be configured on the index BEFORE indexing for filters to work.`,
  },

  /* ─── Layer I — Fintech / banking / BaaS ───────────────────────────── */

  // (plaid is already defined earlier in this file — see line ~325)

  teller: {
    displayName: "Teller (US bank data)",
    npmPackage: null,
    docsUrl: "https://teller.io/docs",
    requiredSecrets: ["TELLER_APPLICATION_ID", "TELLER_SIGNING_SECRET"],
    promptBlock: `### Universal Integration: Teller
- No official Node SDK — call REST directly from a server function with \`fetch\`.
- Secrets: \`TELLER_APPLICATION_ID\` (public, used in browser SDK), \`TELLER_SIGNING_SECRET\` (server-only, for webhook verification). Auth uses mTLS — upload your client certificate via Teller dashboard, attach as Node \`https.Agent\` or Cloudflare Workers \`fetch\` with mTLS bindings.
- Flow: client SDK \`TellerConnect.setup\` → user logs into bank → enrollment token → server calls \`https://api.teller.io/accounts\` etc.
- Pitfall: Teller requires per-environment client certificates. Workers runtime can't load arbitrary cert files at runtime — register the cert at deploy time. Always verify webhook \`Teller-Signature\` before processing.`,
  },

  unit: {
    displayName: "Unit (BaaS)",
    npmPackage: "@unit-finance/unit-node-sdk",
    docsUrl: "https://docs.unit.co/",
    requiredSecrets: ["UNIT_API_TOKEN"],
    promptBlock: `### Universal Integration: Unit
- Install: \`npm install @unit-finance/unit-node-sdk\`
- Secret: \`UNIT_API_TOKEN\` (Bearer; sandbox vs prod is by token, not URL switch)
- Server example (create a customer):
  \`\`\`ts
  import { Unit } from "@unit-finance/unit-node-sdk";
  const unit = new Unit(process.env.UNIT_API_TOKEN!, "https://api.s.unit.sh");
  const customer = await unit.customers.create({ type: "individualCustomer", attributes: { /* ... */ } });
  \`\`\`
- Webhooks: register at Unit dashboard, verify HMAC \`X-Signature\` on a public route BEFORE processing.
- Pitfall: ALL money-moving endpoints require an \`Idempotency-Key\` header (UUID). Without it, retries can double-charge. Customer KYC via Unit's Onboarding flow is required before any transaction.`,
  },

  increase: {
    displayName: "Increase (US BaaS)",
    npmPackage: "increase",
    docsUrl: "https://increase.com/documentation",
    requiredSecrets: ["INCREASE_API_KEY"],
    promptBlock: `### Universal Integration: Increase
- Install: \`npm install increase\`
- Secret: \`INCREASE_API_KEY\` (Bearer)
- Server example:
  \`\`\`ts
  import Increase from "increase";
  const client = new Increase({ apiKey: process.env.INCREASE_API_KEY });
  const transfer = await client.achTransfers.create({ /* ... */ }, { idempotencyKey: crypto.randomUUID() });
  \`\`\`
- Webhooks: HMAC-SHA-256 of body using your endpoint secret, header \`Increase-Webhook-Signature\`. Verify BEFORE processing.
- Pitfall: ACH transfers are reversible for ~60 days; design DB schema to track \`status\` updates from webhooks, never assume "submitted" = "settled".`,
  },

  dwolla: {
    displayName: "Dwolla (ACH payments)",
    npmPackage: "dwolla-v2",
    docsUrl: "https://developers.dwolla.com/",
    requiredSecrets: ["DWOLLA_KEY", "DWOLLA_SECRET", "DWOLLA_ENV"],
    promptBlock: `### Universal Integration: Dwolla
- Install: \`npm install dwolla-v2\`
- Secrets: \`DWOLLA_KEY\`, \`DWOLLA_SECRET\`, \`DWOLLA_ENV\` (\`sandbox\` or \`production\`)
- Server example:
  \`\`\`ts
  import { Client } from "dwolla-v2";
  const dwolla = new Client({ key: process.env.DWOLLA_KEY!, secret: process.env.DWOLLA_SECRET!, environment: process.env.DWOLLA_ENV as "sandbox" | "production" });
  const res = await dwolla.post("transfers", { _links: { source: { href: srcUrl }, destination: { href: dstUrl } }, amount: { currency: "USD", value: "10.00" } });
  \`\`\`
- Webhooks: HMAC-SHA-256 verify on a public route. Always idempotent — store \`event.id\` and skip duplicates.
- Pitfall: customer onboarding requires KYC; you must collect SSN-last-4 and DOB for unverified-customer creation. Never log raw SSNs.`,
  },

  "modern-treasury": {
    displayName: "Modern Treasury",
    npmPackage: "modern-treasury",
    docsUrl: "https://docs.moderntreasury.com/",
    requiredSecrets: ["MODERN_TREASURY_API_KEY", "MODERN_TREASURY_ORGANIZATION_ID"],
    promptBlock: `### Universal Integration: Modern Treasury
- Install: \`npm install modern-treasury\`
- Secrets: \`MODERN_TREASURY_API_KEY\`, \`MODERN_TREASURY_ORGANIZATION_ID\`
- Server example:
  \`\`\`ts
  import ModernTreasury from "modern-treasury";
  const mt = new ModernTreasury({ apiKey: process.env.MODERN_TREASURY_API_KEY!, organizationId: process.env.MODERN_TREASURY_ORGANIZATION_ID! });
  const payment = await mt.paymentOrders.create({ type: "ach", amount: 10000, direction: "debit", originating_account_id: acctId, receiving_account_id: rxId }, { idempotencyKey: crypto.randomUUID() });
  \`\`\`
- Webhooks: verify \`X-Signature\` (HMAC) BEFORE processing. Always send Idempotency-Key on creates.
- Pitfall: ledger reconciliation is core — model accounts/transactions in your DB to mirror MT entries, otherwise you'll lose audit trail.`,
  },

  "stripe-issuing": {
    displayName: "Stripe Issuing (cards)",
    npmPackage: "stripe",
    docsUrl: "https://stripe.com/docs/issuing",
    requiredSecrets: ["STRIPE_SECRET_KEY"],
    promptBlock: `### Universal Integration: Stripe Issuing
- Install: \`npm install stripe\` (already required if Stripe is enabled)
- Secret: \`STRIPE_SECRET_KEY\` (server only)
- Issue a virtual card:
  \`\`\`ts
  import Stripe from "stripe";
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const cardholder = await stripe.issuing.cardholders.create({ name, email, phone_number, status: "active", type: "individual", individual: { first_name, last_name, dob: { day, month, year } } });
  const card = await stripe.issuing.cards.create({ cardholder: cardholder.id, currency: "usd", type: "virtual" });
  \`\`\`
- Webhooks: subscribe to \`issuing_authorization.request\` for real-time approvals — must respond < 2s with approve/decline, or Stripe auto-declines.
- Pitfall: Issuing is gated; the Stripe account must be approved before live cards work. Sandbox uses test cards. Authorization webhooks need an immediate decision — keep handler logic minimal, queue heavy work for after the response.`,
  },

  "stripe-treasury": {
    displayName: "Stripe Treasury (BaaS in US)",
    npmPackage: "stripe",
    docsUrl: "https://stripe.com/docs/treasury",
    requiredSecrets: ["STRIPE_SECRET_KEY"],
    promptBlock: `### Universal Integration: Stripe Treasury
- Install: \`npm install stripe\`
- Secret: \`STRIPE_SECRET_KEY\`
- Open a Financial Account, send Outbound Payments / Outbound Transfers, attach Issued Cards. Use Stripe Connect Custom accounts for end-users.
- Pitfall: Treasury is invite-only and US-only. Onboarded platforms must hold a Money Transmitter program with Stripe. Always design for held funds reconciliation.`,
  },

  "financial-connections": {
    displayName: "Stripe Financial Connections",
    npmPackage: "stripe",
    docsUrl: "https://stripe.com/docs/financial-connections",
    requiredSecrets: ["STRIPE_SECRET_KEY"],
    promptBlock: `### Universal Integration: Stripe Financial Connections (bank linking)
- Install: \`npm install stripe @stripe/stripe-js\`
- Secret: \`STRIPE_SECRET_KEY\` server-side; publishable key client-side
- Flow: server creates a Session → client mounts Financial Connections widget → returns linked Account ID → server fetches accounts/balances/transactions.
- Use this INSTEAD of Plaid if the user is already on Stripe (no Plaid contract, ACH verification flows directly into Stripe).
- Pitfall: transactions endpoint requires the \`transactions\` permission requested at session creation — easy to miss.`,
  },

  wise: {
    displayName: "Wise (international payouts)",
    npmPackage: null,
    docsUrl: "https://docs.wise.com/api-docs",
    requiredSecrets: ["WISE_API_TOKEN", "WISE_PROFILE_ID"],
    promptBlock: `### Universal Integration: Wise
- No official Node SDK — call REST with \`fetch\`. Base: \`https://api.transferwise.com\` (live) / \`https://api.sandbox.transferwise.tech\` (sandbox)
- Secrets: \`WISE_API_TOKEN\` (Bearer), \`WISE_PROFILE_ID\`
- Flow: create quote → create recipient → create transfer → fund transfer (this last step requires SCA / Strong Customer Auth — a signed JWT using a private key the user uploads).
- Pitfall: payouts require SCA signing for any transfer over the per-currency limit. Generate an Ed25519 keypair, register the public key with Wise, sign the funding request server-side. NEVER include the private key in client bundles.`,
  },

  /* ─── Layer I — Crypto / web3 ──────────────────────────────────────── */

  viem: {
    displayName: "viem (modern Ethereum client)",
    npmPackage: "viem",
    docsUrl: "https://viem.sh",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: viem
- Install: \`npm install viem\`
- No secret required for read-only RPC (use a public endpoint or Alchemy/Infura URL via env). For writes, the user's wallet signs via wagmi/RainbowKit — server NEVER holds the user's private key.
- Read example:
  \`\`\`ts
  import { createPublicClient, http } from "viem";
  import { mainnet } from "viem/chains";
  const client = createPublicClient({ chain: mainnet, transport: http(process.env.RPC_URL) });
  const balance = await client.getBalance({ address: "0x..." });
  \`\`\`
- Pitfall: prefer viem over ethers for new code (smaller, type-safe, better tree-shaking). Never call \`createWalletClient\` with a server-side private key for user funds — that's custodial and out of scope.`,
  },

  wagmi: {
    displayName: "wagmi (React hooks for Ethereum)",
    npmPackage: "wagmi",
    docsUrl: "https://wagmi.sh",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: wagmi
- Install: \`npm install wagmi viem @tanstack/react-query\` (React Query is a peer dep)
- No secret. Wrap the app in \`<WagmiProvider>\` + \`<QueryClientProvider>\`; use \`useAccount()\`, \`useConnect()\`, \`useReadContract()\`, \`useWriteContract()\` in components.
- Setup:
  \`\`\`ts
  import { createConfig, http } from "wagmi";
  import { mainnet, base } from "wagmi/chains";
  import { injected, walletConnect } from "wagmi/connectors";
  export const config = createConfig({
    chains: [mainnet, base],
    connectors: [injected(), walletConnect({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID! })],
    transports: { [mainnet.id]: http(), [base.id]: http() },
  });
  \`\`\`
- Pitfall: SSR. Wrap WagmiProvider in a client-only boundary or guard with \`typeof window !== "undefined"\` — wagmi touches \`window\` on init.`,
  },

  rainbowkit: {
    displayName: "RainbowKit (wallet connect UI)",
    npmPackage: "@rainbow-me/rainbowkit",
    docsUrl: "https://www.rainbowkit.com/docs/installation",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: RainbowKit
- Install: \`npm install @rainbow-me/rainbowkit wagmi viem @tanstack/react-query\`
- Public env: \`VITE_WALLETCONNECT_PROJECT_ID\` (get from cloud.walletconnect.com — required for WalletConnect connector).
- Wrap app: \`<WagmiProvider><QueryClientProvider><RainbowKitProvider>{children}</RainbowKitProvider>...\`. Use \`<ConnectButton />\` for the connect UI.
- Pitfall: import its CSS once: \`import "@rainbow-me/rainbowkit/styles.css"\`. Without it, the modal looks unstyled.`,
  },

  ethers: {
    displayName: "ethers.js",
    npmPackage: "ethers",
    docsUrl: "https://docs.ethers.org/v6/",
    requiredSecrets: [],
    promptBlock: `### Universal Integration: ethers.js (v6)
- Install: \`npm install ethers\`
- Read example:
  \`\`\`ts
  import { JsonRpcProvider, formatEther } from "ethers";
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const balance = await provider.getBalance("0x...");
  console.log(formatEther(balance));
  \`\`\`
- Pitfall: v6 API differs from v5 (e.g. \`utils.formatEther\` is now top-level \`formatEther\`). For new builds prefer \`viem\` — smaller, type-safe, faster.`,
  },

  alchemy: {
    displayName: "Alchemy (multi-chain RPC + indexed APIs)",
    npmPackage: "alchemy-sdk",
    docsUrl: "https://docs.alchemy.com/",
    requiredSecrets: ["ALCHEMY_API_KEY"],
    promptBlock: `### Universal Integration: Alchemy
- Install: \`npm install alchemy-sdk\`
- Server secret: \`ALCHEMY_API_KEY\` (server-only — for client RPC use the WebSocket/HTTP URL via VITE_ env if rate limits allow exposing it).
- Server example:
  \`\`\`ts
  import { Alchemy, Network } from "alchemy-sdk";
  const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_API_KEY!, network: Network.ETH_MAINNET });
  const balances = await alchemy.core.getTokenBalances("0x...");
  const nfts = await alchemy.nft.getNftsForOwner("0x...");
  \`\`\`
- Pitfall: per-network API keys differ for some products (e.g. Webhooks use a separate Notify auth token).`,
  },

  helius: {
    displayName: "Helius (Solana RPC + APIs)",
    npmPackage: "helius-sdk",
    docsUrl: "https://docs.helius.dev/",
    requiredSecrets: ["HELIUS_API_KEY"],
    promptBlock: `### Universal Integration: Helius
- Install: \`npm install helius-sdk\`
- Server secret: \`HELIUS_API_KEY\`
- Server example:
  \`\`\`ts
  import { Helius } from "helius-sdk";
  const helius = new Helius(process.env.HELIUS_API_KEY!);
  const txs = await helius.rpc.getSignaturesForAddress("walletPubkey...");
  \`\`\`
- Pitfall: Solana RPC endpoints are aggressively rate-limited; use Helius's enhanced \`getAssetsByOwner\` instead of polling vanilla RPC.`,
  },

  moonpay: {
    displayName: "MoonPay (fiat on/off-ramp)",
    npmPackage: "@moonpay/moonpay-react",
    docsUrl: "https://dev.moonpay.com/docs",
    requiredSecrets: ["MOONPAY_API_KEY", "MOONPAY_SECRET_KEY"],
    promptBlock: `### Universal Integration: MoonPay
- Install: \`npm install @moonpay/moonpay-react\`
- Secrets: \`MOONPAY_API_KEY\` (publishable, OK in browser), \`MOONPAY_SECRET_KEY\` (server-only — used to sign URLs)
- Flow: server signs the buy/sell URL with \`crypto.createHmac("sha256", SECRET).update(url).digest("base64")\`, returns it; client renders \`<MoonPayBuyWidget />\` with the signed URL.
- Pitfall: never sign in the browser — the secret would leak. KYC happens inside MoonPay; webhooks notify your backend on transaction status.`,
  },

  ramp: {
    displayName: "Ramp Network (fiat on-ramp)",
    npmPackage: "@ramp-network/ramp-instant-sdk",
    docsUrl: "https://docs.ramp.network/",
    requiredSecrets: ["RAMP_HOST_API_KEY"],
    promptBlock: `### Universal Integration: Ramp Network
- Install: \`npm install @ramp-network/ramp-instant-sdk\`
- Public key: \`RAMP_HOST_API_KEY\` (publishable, OK in client). For webhook verification you'll separately get a webhook secret from Ramp dashboard.
- Client example:
  \`\`\`ts
  import { RampInstantSDK } from "@ramp-network/ramp-instant-sdk";
  new RampInstantSDK({ hostAppName: "MyApp", hostLogoUrl: "...", swapAsset: "ETH", userAddress: address, hostApiKey: import.meta.env.VITE_RAMP_HOST_API_KEY }).show();
  \`\`\`
- Pitfall: verify webhook signatures (ECDSA P-256) BEFORE crediting any user balance.`,
  },

  transak: {
    displayName: "Transak (fiat on/off-ramp)",
    npmPackage: "@transak/transak-sdk",
    docsUrl: "https://docs.transak.com/",
    requiredSecrets: ["TRANSAK_API_KEY"],
    promptBlock: `### Universal Integration: Transak
- Install: \`npm install @transak/transak-sdk\`
- Public key: \`TRANSAK_API_KEY\` (publishable). Webhook secret separately for backend verification.
- Pitfall: the staging environment uses a different API key + base URL — make the env explicit (\`environment: "STAGING" | "PRODUCTION"\`) so you don't accidentally ship sandbox to prod.`,
  },

  coingecko: {
    displayName: "CoinGecko (prices, market data)",
    npmPackage: null,
    docsUrl: "https://docs.coingecko.com/reference/introduction",
    requiredSecrets: ["COINGECKO_API_KEY"],
    promptBlock: `### Universal Integration: CoinGecko
- No SDK — \`fetch\` directly. Base: \`https://api.coingecko.com/api/v3\` (Demo) or \`https://pro-api.coingecko.com/api/v3\` (Pro).
- Secret: \`COINGECKO_API_KEY\` (free demo tier exists; pro tier needed for higher rate limits)
- Server example:
  \`\`\`ts
  const r = await fetch(\`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd\`, { headers: { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY! } });
  \`\`\`
- Pitfall: free tier is 30 calls/min — cache aggressively (60s+) on the server, never call from the client in a loop.`,
  },

  moralis: {
    displayName: "Moralis (multi-chain APIs)",
    npmPackage: "moralis",
    docsUrl: "https://docs.moralis.io/",
    requiredSecrets: ["MORALIS_API_KEY"],
    promptBlock: `### Universal Integration: Moralis
- Install: \`npm install moralis\`
- Server secret: \`MORALIS_API_KEY\`
- Server example:
  \`\`\`ts
  import Moralis from "moralis";
  await Moralis.start({ apiKey: process.env.MORALIS_API_KEY! });
  const balances = await Moralis.EvmApi.token.getWalletTokenBalances({ address, chain: "0x1" });
  \`\`\`
- Pitfall: \`Moralis.start\` is global — call it ONCE per process, not per request. Memoize via a module-level promise.`,
  },
};

