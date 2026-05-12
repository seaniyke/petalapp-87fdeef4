/**
 * Industry Packs — opinionated, multi-page starters tuned per industry.
 *
 * Each pack composes a *richer* prompt than a single template: page list,
 * sections-per-page, theme direction, and the Cloud features Petal should
 * suggest enabling (auth/email/payments/etc). The detail page assembles this
 * into one prompt and ships the user into the builder.
 *
 * Why separate from start-ideas: templates are 1-line prompts, packs are
 * full briefs. Different surface, different intent.
 */
import {
  Utensils,
  Home as HomeIcon,
  Dumbbell,
  Briefcase,
  Mail,
  CalendarCheck,
  Store,
  Megaphone,
  Landmark,
  Coins,
  FileText,
  type LucideIcon,
} from "lucide-react";

export type CloudFeature =
  | "auth"
  | "database"
  | "email"
  | "payments"
  | "storage"
  | "ai"
  | "analytics";

export type IndustryPack = {
  slug: string;
  name: string;
  tagline: string;
  Icon: LucideIcon;
  /** Short marketing blurb for the gallery card. */
  blurb: string;
  /** Hex/oklch palette anchors used for the preview swatch. */
  palette: { name: string; cssVar: string; sample: string }[];
  /** Display fonts paired for the pack. */
  typography: { display: string; body: string };
  /** Pages the AI should scaffold. */
  pages: { path: string; purpose: string }[];
  /** Cloud features to auto-suggest enabling after generation. */
  cloud: CloudFeature[];
  /** Long-form composed brief sent to the builder. */
  brief: string;
};

export const INDUSTRY_PACKS: IndustryPack[] = [
  {
    slug: "restaurant",
    name: "Restaurant",
    tagline: "Menu, reservations, and a story that makes them hungry",
    Icon: Utensils,
    blurb:
      "A warm, food-forward site for an independent restaurant — full menu, online reservations, gallery, and a press section.",
    palette: [
      { name: "Terracotta", cssVar: "--accent", sample: "#C75D3C" },
      { name: "Cream", cssVar: "--background", sample: "#FBF6EE" },
      { name: "Olive", cssVar: "--muted", sample: "#5A6B3B" },
    ],
    typography: { display: "Fraunces", body: "Inter" },
    pages: [
      { path: "/", purpose: "Hero with cuisine vibe, today's specials, story teaser, CTA to reserve" },
      { path: "/menu", purpose: "Full menu by section (starters, mains, desserts, drinks) with prices and dietary tags" },
      { path: "/reservations", purpose: "Booking form (date, time, party size, name, phone, notes) saved to database" },
      { path: "/about", purpose: "Owner story, sourcing philosophy, team photos" },
      { path: "/gallery", purpose: "Lightbox grid of food + interior photos" },
      { path: "/contact", purpose: "Address, hours, phone, embedded map, contact form" },
    ],
    cloud: ["database", "email", "storage"],
    brief: `A complete restaurant website with warm, editorial design (terracotta + cream, Fraunces display font). Build these pages:

1. Home — hero with bold cuisine photography, today's specials strip, two-column "our story" teaser, prominent "Reserve a table" CTA.
2. Menu — full menu organised by section (Starters, Mains, Desserts, Drinks). Each item has name, description, price, and dietary tags (V, GF, etc).
3. Reservations — booking form (date, time, party size, name, phone, special requests). Save to the database and send a confirmation email.
4. About — owner story, sourcing philosophy, team grid.
5. Gallery — masonry grid of food + interior photos with lightbox.
6. Contact — address, hours per day, phone, embedded map, contact form.

Use a warm cream background, terracotta accent, olive secondary, and a serif display font paired with a clean sans body. Photography-led, generous whitespace, no stock-template feel.`,
  },
  {
    slug: "real-estate",
    name: "Real estate",
    tagline: "Listings, agent profiles, and lead capture that actually converts",
    Icon: HomeIcon,
    blurb:
      "A polished agency site with searchable listings, agent profiles, and a buyer-lead capture funnel.",
    palette: [
      { name: "Deep navy", cssVar: "--primary", sample: "#0F2A4A" },
      { name: "Sand", cssVar: "--background", sample: "#F4EFE6" },
      { name: "Brass", cssVar: "--accent", sample: "#B8893C" },
    ],
    typography: { display: "Playfair Display", body: "Inter" },
    pages: [
      { path: "/", purpose: "Hero with featured listing, search bar, neighborhood highlights" },
      { path: "/listings", purpose: "Searchable/filterable grid (price, beds, baths, location)" },
      { path: "/listings/$slug", purpose: "Listing detail: gallery, specs, map, agent contact, schedule a viewing" },
      { path: "/agents", purpose: "Agent grid with photo, specialty, and contact" },
      { path: "/sell", purpose: "Seller lead-capture page with valuation request form" },
      { path: "/about", purpose: "Agency story, awards, testimonials" },
    ],
    cloud: ["database", "email", "storage", "auth"],
    brief: `A premium real estate agency site with editorial typography (Playfair display, Inter body) and a confident navy + brass + sand palette.

Pages:
1. Home — full-bleed hero of a featured listing, search bar (location, price range, beds), 3 neighborhood highlight cards.
2. /listings — filterable grid (price, beds, baths, type, location) backed by a database table.
3. /listings/$slug — image gallery, specs table, embedded map, agent card, "Schedule a viewing" form.
4. /agents — agent grid with photo, name, specialty, languages, contact.
5. /sell — seller lead-capture page: free valuation form (address, beds, baths, condition) saved to db, email notification to agency.
6. /about — agency story, awards, testimonial carousel.

Use serif display + sans body, generous whitespace, large photography. Build the listings table with realistic seed data (5-8 properties).`,
  },
  {
    slug: "fitness",
    name: "Fitness studio",
    tagline: "Class schedules, trainer bios, and trial-class signups",
    Icon: Dumbbell,
    blurb:
      "An energetic studio site with a weekly class schedule, trainer profiles, membership tiers, and free-trial booking.",
    palette: [
      { name: "Electric lime", cssVar: "--primary", sample: "#C5F23A" },
      { name: "Charcoal", cssVar: "--background", sample: "#0F1112" },
      { name: "White", cssVar: "--foreground", sample: "#FFFFFF" },
    ],
    typography: { display: "Space Grotesk", body: "Inter" },
    pages: [
      { path: "/", purpose: "Bold hero, class types row, member testimonials, trial CTA" },
      { path: "/schedule", purpose: "Weekly class grid with class type, trainer, time, capacity, book button" },
      { path: "/trainers", purpose: "Trainer profiles with bio, specialties, social links" },
      { path: "/membership", purpose: "3-tier pricing (Drop-in, Monthly, Annual) with Stripe checkout" },
      { path: "/trial", purpose: "Free trial class booking form" },
    ],
    cloud: ["database", "email", "payments", "auth"],
    brief: `A high-energy fitness studio site. Dark charcoal background, electric lime primary, bold sans display (Space Grotesk).

Pages:
1. Home — bold full-height hero with motion-y headline, class-types row (HIIT, Yoga, Strength, Spin), 3 member testimonials, "Book your free trial" CTA.
2. /schedule — weekly class grid (Mon–Sun rows, time-slot columns) showing class name, trainer, capacity, "Book" button.
3. /trainers — trainer cards with photo, specialties, bio, social links.
4. /membership — 3 pricing tiers (Drop-in $25, Monthly $129, Annual $1290) with Stripe checkout and an authenticated /account page showing membership status.
5. /trial — free-trial booking form (name, email, phone, preferred class, date) saved to db and emailed to the studio.

Use bold motion, big type, gritty energy. Not soft, not corporate.`,
  },
  {
    slug: "consultancy",
    name: "Consultancy",
    tagline: "Authority, case studies, and a serious lead form",
    Icon: Briefcase,
    blurb:
      "A confident consultancy site with services, case studies, team, and a thoughtful inquiry form.",
    palette: [
      { name: "Ink", cssVar: "--foreground", sample: "#111418" },
      { name: "Bone", cssVar: "--background", sample: "#F2EFE9" },
      { name: "Signal red", cssVar: "--accent", sample: "#D33A2C" },
    ],
    typography: { display: "GT Sectra", body: "Inter" },
    pages: [
      { path: "/", purpose: "Editorial hero, services row, featured case study, client logos, CTA" },
      { path: "/services", purpose: "Service offerings with deliverables and engagement model" },
      { path: "/work", purpose: "Case study grid" },
      { path: "/work/$slug", purpose: "Case study detail with problem, approach, outcome, metrics" },
      { path: "/team", purpose: "Senior team profiles" },
      { path: "/contact", purpose: "Inquiry form (company, project type, budget, timeline, message)" },
    ],
    cloud: ["database", "email"],
    brief: `A senior, editorial consultancy site. Ink on bone background, signal-red accent, serif display (GT Sectra) + clean sans body. Confident, asymmetric layouts, generous whitespace.

Pages:
1. Home — editorial hero with a sharp positioning statement, services row, one featured case study (image left, copy right), client logo strip, "Start a project" CTA.
2. /services — 3-5 service offerings, each with deliverables, timeline, and how engagement works.
3. /work — case study grid (cover image, client, outcome metric).
4. /work/$slug — full case study: problem, approach, outcome, metrics, testimonial.
5. /team — senior profiles with bio + LinkedIn.
6. /contact — proper inquiry form (company, project type, budget bracket, timeline, message). Save to db, email the team.

Tone: confident, restrained, premium. No buzzwords.`,
  },
  {
    slug: "newsletter",
    name: "Newsletter",
    tagline: "A signup magnet and a clean archive readers come back to",
    Icon: Mail,
    blurb:
      "A newsletter site with conversion-focused signup, an archive of past issues, and per-issue pages.",
    palette: [
      { name: "Paper", cssVar: "--background", sample: "#FFFDF7" },
      { name: "Ink", cssVar: "--foreground", sample: "#0E0E10" },
      { name: "Marigold", cssVar: "--accent", sample: "#F5B042" },
    ],
    typography: { display: "Tiempos Headline", body: "Inter" },
    pages: [
      { path: "/", purpose: "Big signup hero, social proof, latest 3 issues, what-you'll-get" },
      { path: "/archive", purpose: "Full archive of past issues, sortable" },
      { path: "/issues/$slug", purpose: "Single issue with rich typography and inline signup CTA" },
      { path: "/about", purpose: "Author bio, why this newsletter exists" },
    ],
    cloud: ["database", "email"],
    brief: `A newsletter site optimised for conversion and reading. Paper background, ink type, marigold accent, serif display (Tiempos) + sans body.

Pages:
1. Home — large signup hero (email + name), social proof ("Read by 4,200 founders"), 3 latest-issue cards, "What you'll get" 3-column row, second signup CTA at bottom. Save signups to db and send confirmation via Resend.
2. /archive — full archive list of past issues with title, date, excerpt, sort by newest.
3. /issues/$slug — single issue with rich editorial typography (drop cap, pull quotes), inline signup CTA two-thirds down.
4. /about — author bio, why this newsletter exists, what to expect.

Reading-first design: max-width prose, generous line-height, real serif typography. Not a SaaS landing page in disguise.`,
  },
  {
    slug: "booking",
    name: "Booking & appointments",
    tagline: "A scheduling site that captures bookings while you sleep",
    Icon: CalendarCheck,
    blurb:
      "A polished booking site for solo professionals (coaches, therapists, consultants) — services, availability calendar, online booking, payment, and a logged-in dashboard.",
    palette: [
      { name: "Sage", cssVar: "--primary", sample: "#5C7A6A" },
      { name: "Bone", cssVar: "--background", sample: "#F4F1EA" },
      { name: "Plum", cssVar: "--accent", sample: "#7A3E5C" },
    ],
    typography: { display: "Fraunces", body: "Inter" },
    pages: [
      { path: "/", purpose: "Hero, services overview, testimonials, prominent Book CTA" },
      { path: "/services", purpose: "Service list with duration, price, and Book button" },
      { path: "/book/$service", purpose: "Calendar slot picker, customer details, Stripe payment" },
      { path: "/about", purpose: "Practitioner story, qualifications, approach" },
      { path: "/account", purpose: "Customer dashboard: upcoming + past bookings, reschedule/cancel" },
      { path: "/admin", purpose: "Admin: today's schedule, all bookings, blocked dates" },
    ],
    cloud: ["database", "email", "payments", "auth"],
    brief: `A booking site for a solo professional. Calm, premium design — sage primary, bone background, plum accent, Fraunces display + Inter body.

Pages:
1. Home — hero with practitioner photo, services overview, 3 testimonials, big "Book a session" CTA.
2. /services — service cards (name, duration, price, short description, Book button).
3. /book/$service — pick a date, see available slots (respect existing bookings + blocked dates, timezone-aware), enter name/email/phone/notes, pay with Stripe, save booking, send confirmation email + calendar invite (.ics).
4. /about — story, qualifications, approach, FAQ.
5. /account — customer-facing dashboard (auth-gated): upcoming + past bookings, reschedule, cancel.
6. /admin — practitioner dashboard: today's schedule, all bookings, block out dates, manage services.

Use a calm, considered aesthetic — not a SaaS landing page. Real database tables: services, bookings, blocked_dates. RLS so customers only see their own bookings.`,
  },
  {
    slug: "marketplace",
    name: "Two-sided marketplace",
    tagline: "Sellers list, buyers buy, you take a cut",
    Icon: Store,
    blurb:
      "A two-sided marketplace starter — seller onboarding, listings, buyer browse + purchase via Stripe Connect, in-app messaging, reviews.",
    palette: [
      { name: "Indigo", cssVar: "--primary", sample: "#3D3A8C" },
      { name: "Paper", cssVar: "--background", sample: "#FAFAF7" },
      { name: "Coral", cssVar: "--accent", sample: "#E8704F" },
    ],
    typography: { display: "Outfit", body: "Inter" },
    pages: [
      { path: "/", purpose: "Hero, featured listings, top categories, become-a-seller CTA" },
      { path: "/browse", purpose: "Searchable, filterable listing grid" },
      { path: "/listings/$slug", purpose: "Listing detail: gallery, price, seller card, Buy button, reviews" },
      { path: "/sell", purpose: "Seller onboarding: Stripe Connect, profile, first listing" },
      { path: "/dashboard/seller", purpose: "Seller dashboard: listings, orders, payouts" },
      { path: "/dashboard/buyer", purpose: "Buyer dashboard: orders, messages, reviews to write" },
      { path: "/messages", purpose: "In-app messaging between buyer and seller per order" },
    ],
    cloud: ["database", "email", "payments", "auth", "storage"],
    brief: `A two-sided marketplace. Confident, slightly playful — indigo primary, paper background, coral accent, Outfit display + Inter body.

Pages:
1. Home — hero with category quick-links, featured listings carousel, "Become a seller" CTA, social proof.
2. /browse — searchable + filterable listing grid (category, price range, location, sort).
3. /listings/$slug — image gallery, title, price, seller card, description, reviews, Buy button (Stripe checkout, escrow-style hold via Stripe Connect destination charges).
4. /sell — seller onboarding flow: Stripe Connect Express account, business details, first listing.
5. /dashboard/seller — listings management, orders to fulfil, payout history.
6. /dashboard/buyer — order history, in-app messages, prompt to leave reviews.
7. /messages — per-order chat thread between buyer and seller (realtime).

Tables: profiles (with seller flag), listings, orders, messages, reviews. RLS strict: sellers see only their listings/orders, buyers see only their orders, messages scoped to order participants. Stripe Connect for split payments.`,
  },
  {
    slug: "creator-social",
    name: "Creator & social",
    tagline: "Link-in-bio, multi-platform scheduling, and an inbox that doesn't suck",
    Icon: Megaphone,
    blurb:
      "A creator command center — link-in-bio landing, cross-platform post scheduler (X, LinkedIn, Threads), unified social inbox, and analytics.",
    palette: [
      { name: "Hot pink", cssVar: "--primary", sample: "#FF3D8A" },
      { name: "Off-black", cssVar: "--background", sample: "#0B0B10" },
      { name: "Citron", cssVar: "--accent", sample: "#E6FF55" },
    ],
    typography: { display: "Space Grotesk", body: "Inter" },
    pages: [
      { path: "/", purpose: "Marketing landing for the creator tool itself with signup CTA" },
      { path: "/u/$handle", purpose: "Public link-in-bio page (avatar, bio, links, latest posts, click tracking)" },
      { path: "/dashboard", purpose: "Creator dashboard: scheduled posts calendar, recent engagement, top links" },
      { path: "/compose", purpose: "Composer: write once, choose targets (X, LinkedIn, Threads, Bluesky), schedule or send now" },
      { path: "/inbox", purpose: "Unified inbox of DMs/comments across linked accounts with reply" },
      { path: "/analytics", purpose: "Per-platform reach, click-through on bio links, top posts" },
      { path: "/settings/connections", purpose: "Connect / disconnect social accounts via OAuth" },
    ],
    cloud: ["database", "email", "auth", "storage", "analytics"],
    brief: `A creator/social command center. Bold, slightly maximalist — hot pink primary, off-black background, citron accent, Space Grotesk display + Inter body. Punchy, modern, not corporate.

Pages:
1. Home — marketing landing for the tool itself: hero, "what it does" feature row (compose once / cross-post / unified inbox / link-in-bio), pricing teaser, signup CTA.
2. /u/$handle — public link-in-bio page (avatar, bio, theme, list of links with click tracking, latest posts pulled from connected accounts).
3. /dashboard — creator dashboard: this-week post calendar, recent engagement (likes/replies across platforms), top-performing bio links.
4. /compose — write a post once, pick targets (X, LinkedIn, Threads, Bluesky), attach media, schedule or send now. Save to a scheduled_posts table; a cron-style worker dispatches to each platform when due.
5. /inbox — unified DM/comments inbox across linked accounts, reply inline, mark as handled.
6. /analytics — per-platform reach + engagement, bio-link CTR, top posts.
7. /settings/connections — OAuth connect/disconnect per platform.

Tables: profiles, bio_pages, bio_links (with click_count), scheduled_posts (with target_platforms[], status, scheduled_at), platform_accounts (per-user OAuth tokens, encrypted), inbox_messages.

Integration brief for the LLM: use per-user OAuth (not workspace connectors) for X v2, LinkedIn UGC, Threads, and Bluesky AT Protocol so each creator authorizes their own accounts. Store refresh tokens in platform_accounts with strict RLS (owner-only). For dispatch, use a server function triggered by pg_cron hitting an /api/public/dispatch-scheduled endpoint that signs requests with a shared secret. Image/video uploads go through Cloud storage with signed URLs.`,
  },
  {
    slug: "neobank",
    name: "Neobank dashboard",
    tagline: "Accounts, transactions, transfers — KYC-aware, demo-safe",
    Icon: Landmark,
    blurb:
      "A modern banking dashboard with accounts list, transaction feed, transfer flow, KYC onboarding, and provider-webhook plumbing. Demo-safe by default.",
    palette: [
      { name: "Indigo", cssVar: "--primary", sample: "#3D5AFE" },
      { name: "Ink", cssVar: "--background", sample: "#0A0F1F" },
      { name: "Mint", cssVar: "--accent", sample: "#34D399" },
    ],
    typography: { display: "Söhne", body: "Inter" },
    pages: [
      { path: "/", purpose: "Marketing landing — trust, security, FDIC-style copy (clearly labelled demo), signup CTA" },
      { path: "/signup", purpose: "Email + password signup, then redirect to KYC" },
      { path: "/onboarding/kyc", purpose: "Multi-step KYC: legal name, DOB, address, ID upload (Persona/Stripe Identity placeholder)" },
      { path: "/dashboard", purpose: "Accounts overview: balance cards, recent transactions, quick-transfer CTA" },
      { path: "/accounts/$id", purpose: "Account detail: full transaction list, filters, statements" },
      { path: "/transfers/new", purpose: "ACH/internal transfer form with idempotency-key, confirmation step" },
      { path: "/admin", purpose: "Ops dashboard: pending KYC reviews, flagged transactions, manual ledger adjustments (admin role only)" },
      { path: "/api/public/webhooks/banking", purpose: "Provider webhook receiver (Plaid/Increase/Unit) — verify signature, idempotency on event_id" },
      { path: "/settings", purpose: "Profile, linked external accounts, notification prefs" },
    ],
    cloud: ["auth", "database", "email", "storage"],
    brief: `A neobank-style banking dashboard. Calm, trustworthy, fintech-modern: indigo primary on ink background, mint success accent, Söhne/Inter pairing. Show clear "DEMO — simulated balances" notices everywhere money is displayed unless real provider keys are configured.

Pages:
1. / — marketing landing: trust messaging, security highlights (encryption, audit log), labelled-demo disclosure, signup CTA.
2. /signup — email + password, redirect to /onboarding/kyc.
3. /onboarding/kyc — multi-step form (legal name, DOB, address, government ID upload). Stub Persona / Stripe Identity integration with TODO comments. Save kyc_status to profiles.
4. /dashboard — accounts list (cards with balance, last 4, type), recent transactions table, "New transfer" CTA. Account-scoped via RLS.
5. /accounts/$id — full transaction list with date/amount/counterparty/status filters, downloadable statement.
6. /transfers/new — amount + destination form. CRITICAL: every money-movement request must include an Idempotency-Key (UUID v4 generated client-side, stored in transfers table). Show confirmation step before submit.
7. /admin — role-gated (user_roles table, has_role() definer fn). KYC review queue, flagged-transaction list, manual journal entries.
8. /api/public/webhooks/banking — POST handler that verifies the provider's HMAC signature, deduplicates on event_id, then writes to a webhook_events table before updating ledger rows.
9. /settings — profile, external account links, notification preferences.

Tables: profiles (kyc_status, role), accounts (user_id, balance_cents, type, last4), transactions (account_id, amount_cents, currency, counterparty, status, posted_at), transfers (idempotency_key UNIQUE, status, provider_ref), webhook_events (provider, event_id UNIQUE, payload, received_at), user_roles (user_id, role).

Integration brief for the LLM: NEVER move real money. Use Plaid for account linking sandbox, Stripe Financial Connections or Increase/Unit/Modern Treasury for ledger — all server-side only via createServerFn, never from the browser. All amounts in integer cents. All money-moving handlers MUST be idempotent on Idempotency-Key. Webhook routes under /api/public/* MUST verify HMAC signature with timingSafeEqual before any write. Display a persistent "Demo balances" banner unless PLAID_SECRET / INCREASE_API_KEY etc. are set.`,
  },
  {
    slug: "crypto-portfolio",
    name: "Crypto portfolio",
    tagline: "Wallet-connect, balances across chains, on/off-ramp aware",
    Icon: Coins,
    blurb:
      "A non-custodial crypto portfolio tracker — wallet connect, multi-chain balances, transaction history, swap/onramp links. No private keys ever leave the wallet.",
    palette: [
      { name: "Electric violet", cssVar: "--primary", sample: "#7C3AED" },
      { name: "Carbon", cssVar: "--background", sample: "#0E0E12" },
      { name: "Lime", cssVar: "--accent", sample: "#A3E635" },
    ],
    typography: { display: "Space Grotesk", body: "Inter" },
    pages: [
      { path: "/", purpose: "Marketing landing — connect-wallet CTA, supported chains, non-custodial messaging" },
      { path: "/dashboard", purpose: "Portfolio overview: total value, per-chain breakdown, top holdings, 24h change" },
      { path: "/holdings", purpose: "Full token table with quantities, USD value, allocation %" },
      { path: "/activity", purpose: "Cross-chain transaction history with explorer links" },
      { path: "/onramp", purpose: "Buy crypto via MoonPay/Ramp/Transak iframe with disclosure" },
      { path: "/settings", purpose: "Manage connected wallets, currency preference, hide-small-balances toggle" },
    ],
    cloud: ["auth", "database", "analytics"],
    brief: `A non-custodial crypto portfolio tracker. Bold web3 aesthetic: electric violet on carbon, lime accent, Space Grotesk display. NEVER ask for or store private keys / seed phrases — that's a hard rule, including in placeholder text.

Pages:
1. / — landing: connect-wallet CTA (RainbowKit modal), supported chains row (Ethereum, Base, Arbitrum, Optimism, Solana), non-custodial trust copy, FAQ.
2. /dashboard — total portfolio value (USD), per-chain breakdown chart, top 5 holdings, 24h change. Scoped to the connected wallet address (or linked profile).
3. /holdings — sortable table: token, chain, balance, USD value, % of portfolio, 24h change.
4. /activity — unified transaction history across chains with type icons (send/receive/swap/contract) and explorer links.
5. /onramp — provider-picker (MoonPay, Ramp, Transak) embedded via their official widget URL. Show fees + KYC disclosure clearly.
6. /settings — list connected wallets, primary currency, hide-small-balances threshold.

Tables: profiles (optional — can run wallet-only), wallets (user_id NULLABLE, address, chain, label), portfolio_snapshots (wallet_id, captured_at, total_usd_cents) for history charts.

Integration brief for the LLM: use wagmi + viem + RainbowKit for wallet connect (browser only). For balances/prices/history use a chain-data provider via server fn — Alchemy (EVM), Helius (Solana), Moralis (multi-chain) — keep API keys server-side in process.env. Use CoinGecko for price USD conversion. NEVER use ethers v5 docs — viem is the standard now. NEVER call wallet.signTransaction or wallet.sendTransaction from server code. Price + balance data is read-only on the server; signing happens client-side via wagmi hooks if a swap is added. Cache price responses 60s. All amounts use BigInt for on-chain values, convert to display only at render time.`,
  },
  {
    slug: "smb-invoicing",
    name: "SMB invoicing",
    tagline: "Quotes, invoices, Stripe payment links, and chase emails",
    Icon: FileText,
    blurb:
      "An invoicing tool for small businesses — clients, line-item invoices, Stripe-hosted payment links, automated reminders, and a clean public invoice page.",
    palette: [
      { name: "Slate blue", cssVar: "--primary", sample: "#1E40AF" },
      { name: "Paper", cssVar: "--background", sample: "#F8FAFC" },
      { name: "Emerald", cssVar: "--accent", sample: "#059669" },
    ],
    typography: { display: "Inter Tight", body: "Inter" },
    pages: [
      { path: "/", purpose: "Marketing landing for the tool itself, signup CTA" },
      { path: "/dashboard", purpose: "Outstanding total, overdue list, recent activity, MRR-style stats" },
      { path: "/clients", purpose: "Client CRM: list + create + edit (name, email, address, currency, notes)" },
      { path: "/invoices", purpose: "Invoice list with status filters (draft/sent/paid/overdue), search, export CSV" },
      { path: "/invoices/new", purpose: "Invoice composer: client picker, line items (qty/desc/rate), tax, due date, Stripe payment link toggle" },
      { path: "/invoices/$id", purpose: "Invoice detail: send via email, mark paid, void, download PDF" },
      { path: "/i/$publicId", purpose: "Public invoice page (no auth) with Pay-with-Stripe button" },
      { path: "/api/public/webhooks/stripe", purpose: "Stripe webhook: verify signature, mark invoice paid on checkout.session.completed" },
      { path: "/settings", purpose: "Business profile (logo, address, default tax, payment terms), Stripe connection" },
    ],
    cloud: ["auth", "database", "email", "payments", "storage"],
    brief: `An invoicing app for small businesses. Clean, professional, finance-software polish: slate-blue primary on paper background, emerald success, Inter Tight display. No clutter, no gradients — money apps need to look trustworthy.

Pages:
1. / — landing: hero with screenshot mock, "what it does" rows (clients/invoices/get-paid/auto-chase), pricing teaser, signup CTA.
2. /dashboard — outstanding total card, overdue invoices list, last 30 days activity feed, paid-this-month stat.
3. /clients — full CRM table with create/edit drawer (name, email, billing address, default currency, notes).
4. /invoices — list with tabs (Draft/Sent/Paid/Overdue), filter, search, export to CSV.
5. /invoices/new — composer: pick client, add line items (qty × rate), apply tax, set due date, optional message, toggle "Generate Stripe payment link". Save as draft or send.
6. /invoices/$id — detail page: PDF preview, "Send" (email via Resend), "Mark paid", "Void", "Download PDF". Activity timeline on the right.
7. /i/$publicId — public client-facing page (no auth, signed publicId). Shows invoice + a big "Pay $X" button that redirects to Stripe Checkout.
8. /api/public/webhooks/stripe — POST handler that verifies stripe-signature with constructEvent and on checkout.session.completed marks the matching invoice paid (idempotent on event.id stored in webhook_events).
9. /settings — business profile (logo upload, address, default tax %, payment terms days), Stripe Connect onboarding link.

Tables: profiles, clients (user_id, name, email, address, currency), invoices (user_id, client_id, public_id UNIQUE, status, currency, subtotal_cents, tax_cents, total_cents, due_at, sent_at, paid_at, stripe_session_id), invoice_items (invoice_id, description, qty, unit_amount_cents), webhook_events (provider, event_id UNIQUE, payload).

Integration brief for the LLM: use Stripe Checkout (mode=payment) generated server-side via createServerFn — never expose secret key to the browser. Webhook route under /api/public/* MUST verify the stripe-signature header with stripe.webhooks.constructEvent and dedupe on event.id. Send email via Resend (RESEND_API_KEY) on invoice send and on payment confirmation. PDF generation: use react-pdf in a server fn or render a print-styled HTML page and use the browser print dialog as v1 fallback. Store all amounts in integer cents.`,
  },
];

export function getPack(slug: string): IndustryPack | undefined {
  return INDUSTRY_PACKS.find((p) => p.slug === slug);
}

export function packToPrompt(pack: IndustryPack): string {
  const cloudHints =
    pack.cloud.length > 0
      ? `\n\nEnable these Cloud features as part of the build: ${pack.cloud.join(", ")}.`
      : "";
  return `${pack.brief}${cloudHints}`;
}
