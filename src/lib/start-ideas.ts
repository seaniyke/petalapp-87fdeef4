/**
 * Shared catalog of starter prompts ("templates") consumed by both the
 * landing-page StartIdeasPanel and the dedicated /templates gallery.
 *
 * Each idea has a category so the templates page can filter, plus an accent
 * for the icon tile. Prompts are intentionally specific (mention features)
 * rather than generic — vague prompts produce vague apps.
 *
 * Why split out of StartIdeasPanel: the landing-page panel only surfaces a
 * curated subset (12), while /templates shows the whole library and lets
 * users filter by what they're trying to build. One source of truth keeps
 * them from drifting.
 */
import {
  Sparkles,
  Calendar,
  ListTodo,
  Camera,
  Users,
  Coffee,
  Music,
  ChartBar,
  Layers,
  BookOpen,
  Briefcase,
  Building2,
  Smartphone,
  Bell,
  CreditCard,
  FileText,
  Receipt,
  Calculator,
  Bot,
  MessageSquare,
  Mail,
  Newspaper,
  Link as LinkIcon,
  Heart,
  Brain,
  Trophy,
  Search,
  ShoppingBag,
  Utensils,
  Dumbbell,
  Home as HomeIcon,
  Scissors,
  Stethoscope,
  GraduationCap,
  KanbanSquare,
  Inbox,
  TrendingUp,
  Gamepad2,
  HelpCircle,
  Globe,
  Wand2,
  Map,
  Mic,
  Video,
  PenTool,
  Puzzle,
  CalendarCheck,
  Store,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type IdeaCategory =
  | "Local business"
  | "AI tools"
  | "SaaS"
  | "Internal tools"
  | "Personal"
  | "Creator"
  | "Mobile"
  | "Directories"
  | "E-commerce"
  | "Games & toys"
  | "Productivity"
  | "Collaboration"
  | "Booking"
  | "Marketplace"
  | "Maps & geo"
  | "Audio & video"
  | "Extensions"
  | "Messaging"
  | "Social";

export type StartIdea = {
  title: string;
  prompt: string;
  Icon: LucideIcon;
  accent: "pink" | "mint" | "lilac" | "sky" | "butter";
  category: IdeaCategory;
  /** Surfaced on landing page; if false, only shown on /templates. */
  featured?: boolean;
};

export const CATEGORY_ORDER: IdeaCategory[] = [
  "SaaS",
  "AI tools",
  "Local business",
  "Internal tools",
  "Creator",
  "Productivity",
  "Personal",
  "Directories",
  "E-commerce",
  "Mobile",
  "Collaboration",
  "Booking",
  "Marketplace",
  "Maps & geo",
  "Audio & video",
  "Extensions",
  "Games & toys",
];

export const START_IDEAS: StartIdea[] = [
  // ── SaaS ────────────────────────────────────────────────────────────────
  {
    title: "Full SaaS product (auth + billing)",
    prompt:
      "A complete SaaS product: marketing landing page, email + Google sign-in, a logged-in dashboard with user-scoped data (RLS), a 3-tier Stripe subscription paywall, account settings, and transactional emails. Build the smallest end-to-end slice first — auth, paywall, and one core feature working together.",
    Icon: CreditCard,
    accent: "lilac",
    category: "SaaS",
    featured: true,
  },
  {
    title: "SaaS marketing site",
    prompt:
      "A small SaaS marketing site with proper pages: home, /features, /pricing (3 tiers), /faq, and a /blog index with /blog/$slug detail routes. Modern dev-tool vibe.",
    Icon: Building2,
    accent: "sky",
    category: "SaaS",
    featured: true,
  },
  {
    title: "Waitlist + lead magnet",
    prompt:
      "A high-conversion waitlist landing page: bold hero, social proof row, 3-feature grid, email capture that stores signups in the database, an admin view of all signups, and a confirmation email via Resend.",
    Icon: Mail,
    accent: "pink",
    category: "SaaS",
  },
  {
    title: "Pricing & paywall starter",
    prompt:
      "A SaaS pricing page with 3 tiers (Free, Pro, Team), a comparison table, FAQ, and a Stripe-powered checkout that gates a /dashboard route by subscription status.",
    Icon: CreditCard,
    accent: "lilac",
    category: "SaaS",
  },

  // ── AI tools ────────────────────────────────────────────────────────────
  {
    title: "AI chatbot for my site",
    prompt:
      "A customer-support chatbot embeddable on any site: chat UI, conversation memory, streaming responses powered by Lovable AI, and a small admin to review past chats.",
    Icon: Bot,
    accent: "lilac",
    category: "AI tools",
    featured: true,
  },
  {
    title: "Resume / ATS analyzer",
    prompt:
      "An AI resume reviewer: upload a PDF resume, AI extracts skills + experience, scores it against a pasted job description, and returns specific bullet-point suggestions to improve it.",
    Icon: FileText,
    accent: "mint",
    category: "AI tools",
    featured: true,
  },
  {
    title: "PDF Q&A",
    prompt:
      "A 'chat with your PDF' tool: upload a document, AI indexes it, and the user can ask questions and get answers with cited page numbers.",
    Icon: FileText,
    accent: "sky",
    category: "AI tools",
  },
  {
    title: "AI summarizer / rewriter",
    prompt:
      "A writing assistant: paste any text, pick a mode (Summarize, Rewrite, Make formal, Make friendly), and stream back the result. Save history per user.",
    Icon: Wand2,
    accent: "lilac",
    category: "AI tools",
  },
  {
    title: "AI cover-letter writer",
    prompt:
      "Paste a job description and your background, AI generates a tailored cover letter in 3 tones (formal, friendly, bold). One-click copy and save to history.",
    Icon: Mail,
    accent: "butter",
    category: "AI tools",
  },
  {
    title: "AI personality quiz",
    prompt:
      "A playful 8-question quiz that uses AI to generate a custom personality archetype with a cute illustration name and a shareable result page.",
    Icon: Brain,
    accent: "pink",
    category: "AI tools",
  },

  // ── Local business ──────────────────────────────────────────────────────
  {
    title: "Restaurant site (4 pages)",
    prompt:
      "A warm restaurant website: home with hero photo, /menu (categorized with prices), /reservations (form that saves to DB + emails confirmation), /visit (hours, address, embedded map). Mobile-first.",
    Icon: Utensils,
    accent: "butter",
    category: "Local business",
    featured: true,
  },
  {
    title: "Coffee shop site",
    prompt:
      "A warm site for an independent coffee shop called Petal & Bean — separate pages for Home, Menu, Our Story, and Visit Us (with a map). Real /menu, /story and /visit routes, linked from a sticky nav.",
    Icon: Coffee,
    accent: "butter",
    category: "Local business",
  },
  {
    title: "Yoga studio (4 pages)",
    prompt:
      "A 4-page site for a neighborhood yoga studio: home, /classes (with weekly schedule), /instructors (bios + photos), and /contact (form + map). Calm editorial vibe.",
    Icon: Layers,
    accent: "mint",
    category: "Local business",
  },
  {
    title: "Real-estate agent site",
    prompt:
      "A realtor's site: home, /listings (grid of properties with photos + price), /listings/$id detail page, /about (bio + testimonials), /contact (lead form that emails the agent).",
    Icon: HomeIcon,
    accent: "sky",
    category: "Local business",
  },
  {
    title: "Salon / barber site",
    prompt:
      "A salon website: home, /services (with prices), /book (booking form that picks stylist + time slot, saves to DB, emails confirmation), /gallery, /contact.",
    Icon: Scissors,
    accent: "pink",
    category: "Local business",
  },
  {
    title: "Fitness studio site",
    prompt:
      "A 4-page fitness studio site: home, /classes (weekly schedule), /trainers (bios), /membership (3 pricing tiers with Stripe). Bold, energetic vibe.",
    Icon: Dumbbell,
    accent: "lilac",
    category: "Local business",
  },
  {
    title: "Dental / clinic site",
    prompt:
      "A friendly dental practice site: home, /services, /team (bios), /book-appointment (form + email confirmation), /contact (map + hours). Calm, trustworthy palette.",
    Icon: Stethoscope,
    accent: "mint",
    category: "Local business",
  },
  {
    title: "Consultancy + case studies",
    prompt:
      "A consultancy website with separate pages for home, /services, /case-studies (index page) plus /case-studies/$slug detail pages, and /about. Confident, editorial tone.",
    Icon: Briefcase,
    accent: "lilac",
    category: "Local business",
  },

  // ── Internal tools ──────────────────────────────────────────────────────
  {
    title: "CRM with kanban pipeline",
    prompt:
      "A CRM: contacts table, deals with kanban columns (Lead → Qualified → Proposal → Won/Lost), drag-and-drop, activity log per deal, search, and CSV import/export. Auth-gated with user-scoped RLS.",
    Icon: KanbanSquare,
    accent: "sky",
    category: "Internal tools",
    featured: true,
  },
  {
    title: "Admin dashboard",
    prompt:
      "An internal admin dashboard: KPI cards at the top, a chart of weekly signups, a recent-activity table, and a side nav. Auth-gated, only admins can access.",
    Icon: TrendingUp,
    accent: "lilac",
    category: "Internal tools",
  },
  {
    title: "Customer feedback inbox",
    prompt:
      "A feedback inbox: public widget that captures feedback (with optional email), an internal /inbox to triage (open/closed, tags), search, and a per-item thread view.",
    Icon: Inbox,
    accent: "mint",
    category: "Internal tools",
  },
  {
    title: "Invoice generator",
    prompt:
      "An invoice tool: create clients, create line-itemed invoices, preview as a PDF-styled page, mark as paid/sent, and a dashboard of outstanding balance.",
    Icon: Receipt,
    accent: "butter",
    category: "Internal tools",
  },
  {
    title: "Team standup board",
    prompt:
      "A team standup board with columns for Yesterday, Today, Blockers — each card has an avatar, name, and timestamp.",
    Icon: Users,
    accent: "mint",
    category: "Internal tools",
  },

  // ── Creator ─────────────────────────────────────────────────────────────
  {
    title: "Newsletter site",
    prompt:
      "A newsletter publication: home with hero + 'Subscribe' (saves to DB, sends a Resend confirmation), /archive of past issues, /issues/$slug post detail, /about. Editorial typography.",
    Icon: Newspaper,
    accent: "butter",
    category: "Creator",
    featured: true,
  },
  {
    title: "Link-in-bio page",
    prompt:
      "A polished link-in-bio page: avatar + headline + 6 link buttons, social icons row, and a small click-counter that logs to the database. Beautiful gradient background.",
    Icon: LinkIcon,
    accent: "pink",
    category: "Creator",
  },
  {
    title: "Photo portfolio (multi-page)",
    prompt:
      "A photographer's portfolio with separate pages: home (masonry preview), /gallery (3 collections each on their own /gallery/$slug page), /about, and /contact form.",
    Icon: Camera,
    accent: "sky",
    category: "Creator",
  },
  {
    title: "Writer's blog",
    prompt:
      "A minimalist writer's blog: home with featured posts, /blog index of all posts, /blog/$slug post detail with prose styling, and a short /about page.",
    Icon: BookOpen,
    accent: "butter",
    category: "Creator",
  },
  {
    title: "Personal portfolio + resume",
    prompt:
      "A clean personal portfolio: hero, /work (project grid → /work/$slug detail), /about (story + skills), /resume (printable view), /contact form. Sharp typography, generous space.",
    Icon: Briefcase,
    accent: "lilac",
    category: "Creator",
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    title: "Habit tracker",
    prompt:
      "A minimalist daily habit tracker with streak counts, a 7-day grid, and confetti when I complete all habits for the day.",
    Icon: ListTodo,
    accent: "mint",
    category: "Productivity",
    featured: true,
  },
  {
    title: "Pomodoro timer",
    prompt:
      "A pastel pomodoro timer with 25/5 cycles, a session counter, gentle chime on transitions, and a daily focus stats chart.",
    Icon: ChartBar,
    accent: "lilac",
    category: "Productivity",
  },
  {
    title: "Gratitude journal",
    prompt:
      "A gratitude journal: write 3 things daily, see past entries on a calendar, search entries, and a weekly mood chart.",
    Icon: Heart,
    accent: "pink",
    category: "Productivity",
  },
  {
    title: "Flashcards (spaced repetition)",
    prompt:
      "A flashcards app: create decks, add cards, study mode with spaced repetition (SM-2), per-deck stats, and a daily review queue.",
    Icon: GraduationCap,
    accent: "sky",
    category: "Productivity",
  },
  {
    title: "Recipe finder",
    prompt:
      "A recipe finder where I type ingredients I have and get 6 recipe cards back, each with a hero photo, time, and difficulty.",
    Icon: Sparkles,
    accent: "butter",
    category: "Productivity",
  },

  // ── Personal ────────────────────────────────────────────────────────────
  {
    title: "Event RSVP page",
    prompt:
      "An RSVP page for a small wedding — hero photo, event details, 'Will you attend?' form, and a guest count that updates live.",
    Icon: Calendar,
    accent: "pink",
    category: "Personal",
  },
  {
    title: "Mood music picker",
    prompt:
      "A playful 'pick your mood' page that recommends a playlist style — 4 mood tiles, a generated playlist name, and a vibe description.",
    Icon: Music,
    accent: "lilac",
    category: "Personal",
  },
  {
    title: "Freelance rate calculator",
    prompt:
      "A freelance rate calculator: enter target salary, expenses, vacation days and billable hours, get an hourly + day rate. Save scenarios per user.",
    Icon: Calculator,
    accent: "mint",
    category: "Personal",
  },

  // ── Directories ─────────────────────────────────────────────────────────
  {
    title: "Niche directory ('Best of X')",
    prompt:
      "A directory site for a niche (e.g. best AI tools): listing cards with logo + tagline + tags, /tools/$slug detail page, search, category filters, and a /submit form that saves new submissions for review.",
    Icon: Search,
    accent: "sky",
    category: "Directories",
    featured: true,
  },
  {
    title: "Job board",
    prompt:
      "A niche remote job board: home grid of jobs with company + tags + salary, /jobs/$id detail, filters (role, remote/hybrid, salary), /post-a-job (Stripe paywall, $99 listing). Email alerts via Resend.",
    Icon: Briefcase,
    accent: "lilac",
    category: "Directories",
  },
  {
    title: "Coach / freelancer marketplace",
    prompt:
      "A two-sided marketplace for coaches: provider profiles with bio + rates + availability, /search with filters, booking flow with Stripe, and a logged-in dashboard for both sides.",
    Icon: Globe,
    accent: "mint",
    category: "Directories",
  },

  // ── E-commerce ──────────────────────────────────────────────────────────
  {
    title: "Single-product landing + Stripe",
    prompt:
      "A single-product launch page: hero with product photo, feature grid, social proof, FAQ, and a 'Buy now' Stripe checkout. Order is saved to the database with email confirmation via Resend.",
    Icon: ShoppingBag,
    accent: "pink",
    category: "E-commerce",
    featured: true,
  },
  {
    title: "Digital download store",
    prompt:
      "A digital downloads store: product catalog, /product/$slug detail, Stripe checkout, and on success deliver a signed download link by email.",
    Icon: ShoppingBag,
    accent: "butter",
    category: "E-commerce",
  },
  {
    title: "Pre-order page",
    prompt:
      "A pre-order page: hero, countdown to launch, 'Reserve yours' Stripe payment, customer dashboard to view their order, and an admin view of all pre-orders.",
    Icon: ShoppingBag,
    accent: "lilac",
    category: "E-commerce",
  },

  // ── Mobile ──────────────────────────────────────────────────────────────
  {
    title: "Mobile habit tracker (iOS + Android)",
    prompt:
      "A native-feel mobile habit tracker I can ship to the App Store and Play Store — bottom tab bar, daily streaks, push notification reminders, and a clean splash screen. Build it as a real iOS and Android app.",
    Icon: Smartphone,
    accent: "pink",
    category: "Mobile",
    featured: true,
  },
  {
    title: "Mobile gratitude journal",
    prompt:
      "A native-feel mobile gratitude journal app — write a daily entry, see past entries in a calendar, get a gentle evening push notification. Ship as iOS and Android.",
    Icon: Bell,
    accent: "mint",
    category: "Mobile",
  },
  {
    title: "Mobile meditation app",
    prompt:
      "A native-feel mobile meditation app — library of guided sessions, a 'today' tab, a streak counter, evening reminder push notification. Ship as iOS and Android.",
    Icon: Heart,
    accent: "lilac",
    category: "Mobile",
  },

  // ── Games & toys ────────────────────────────────────────────────────────
  {
    title: "Trivia game",
    prompt:
      "A trivia game: pick a category, answer 10 multiple-choice questions on a timer, score screen with a leaderboard saved to the database. Playful pastel UI.",
    Icon: Trophy,
    accent: "butter",
    category: "Games & toys",
  },
  {
    title: "'This or that' game",
    prompt:
      "A daily 'this or that' game: AI generates two whimsical options, the user picks one, see the global vote split. Saves picks per user with a streak.",
    Icon: HelpCircle,
    accent: "pink",
    category: "Games & toys",
  },
  {
    title: "Word puzzle (Wordle-style)",
    prompt:
      "A daily word puzzle in the spirit of Wordle: 6 guesses to find a 5-letter word, color feedback per letter, share-your-result button, daily streak.",
    Icon: Gamepad2,
    accent: "sky",
    category: "Games & toys",
  },

  // ── Misc featured ───────────────────────────────────────────────────────
  {
    title: "Forum / discussion board",
    prompt:
      "A small community forum: categories, threads with replies, upvotes, user profiles, search. Auth-gated posting with RLS.",
    Icon: MessageSquare,
    accent: "lilac",
    category: "SaaS",
  },

  // ── Collaboration / multiplayer ─────────────────────────────────────────
  {
    title: "Realtime collaborative whiteboard",
    prompt:
      "A multiplayer whiteboard: shared canvas with sticky notes, pen tool, and shapes. Live cursors with each user's name, presence indicators, and persistent boards saved per user. Use Supabase Realtime for sync.",
    Icon: PenTool,
    accent: "sky",
    category: "Collaboration",
    featured: true,
  },
  {
    title: "Live document editor",
    prompt:
      "A collaborative document editor like Google Docs lite: rich-text editing, multiple users typing at once with live cursors and selections, autosave, and a document list per workspace. Realtime via Supabase channels.",
    Icon: FileText,
    accent: "mint",
    category: "Collaboration",
  },
  {
    title: "Team chat (Slack-lite)",
    prompt:
      "A team chat app: workspaces, channels, threaded replies, @mentions, typing indicators, and unread badges. Realtime messages via Supabase, auth-gated, RLS per workspace.",
    Icon: MessageSquare,
    accent: "lilac",
    category: "Collaboration",
  },
  {
    title: "Realtime poll / Q&A",
    prompt:
      "A live audience Q&A and poll tool for events: host creates a session, audience joins via short code, submits questions, upvotes others'. Host sees live ranking. Realtime updates.",
    Icon: TrendingUp,
    accent: "pink",
    category: "Collaboration",
  },

  // ── Booking / calendar ──────────────────────────────────────────────────
  {
    title: "Appointment booking (Calendly-lite)",
    prompt:
      "A booking page where visitors pick a time slot from my availability, fill name/email, and book. Sends confirmation email, prevents double-booking, and shows my upcoming bookings in a logged-in dashboard. Timezone-aware.",
    Icon: CalendarCheck,
    accent: "mint",
    category: "Booking",
    featured: true,
  },
  {
    title: "Salon / barber booking",
    prompt:
      "A booking site for a salon: services list with duration and price, staff picker, calendar slot selection, customer details, confirmation email. Admin view of upcoming bookings.",
    Icon: Scissors,
    accent: "pink",
    category: "Booking",
  },
  {
    title: "Class / workshop signup",
    prompt:
      "A workshop signup site: list of upcoming classes with date, capacity, price; visitors reserve a seat with Stripe payment; capacity decrements live. Email confirmation + reminder 24h before.",
    Icon: GraduationCap,
    accent: "butter",
    category: "Booking",
  },
  {
    title: "Restaurant table reservations",
    prompt:
      "A reservation widget for a restaurant: party size, date, time slots respecting capacity, name + phone. Stores bookings, emails confirmation, host dashboard for tonight's covers.",
    Icon: Utensils,
    accent: "butter",
    category: "Booking",
  },

  // ── Marketplace / two-sided ─────────────────────────────────────────────
  {
    title: "Two-sided marketplace",
    prompt:
      "A two-sided marketplace (think Etsy-lite): sellers create listings with photos and price, buyers browse/search/filter, Stripe Connect handles seller payouts, in-app messaging between buyer and seller. Reviews per listing.",
    Icon: Store,
    accent: "lilac",
    category: "Marketplace",
    featured: true,
  },
  {
    title: "Freelance services marketplace",
    prompt:
      "A services marketplace (Fiverr-lite): freelancers list gigs with tiers (Basic/Standard/Premium), buyers order with Stripe escrow-style hold, in-app chat, delivery + review flow.",
    Icon: Briefcase,
    accent: "sky",
    category: "Marketplace",
  },
  {
    title: "Local rental marketplace",
    prompt:
      "A peer-to-peer rental marketplace (camera gear, tools, party supplies): owners list items by day rate, renters book a date range, Stripe payment with damage deposit, calendar shows availability.",
    Icon: Store,
    accent: "mint",
    category: "Marketplace",
  },

  // ── Maps & geo ──────────────────────────────────────────────────────────
  {
    title: "Local directory with map",
    prompt:
      "A local business directory with an interactive Mapbox map: searchable list, filter by category, click pin to see details, submit-a-listing form. Use Mapbox GL JS.",
    Icon: Map,
    accent: "sky",
    category: "Maps & geo",
    featured: true,
  },
  {
    title: "Delivery tracker",
    prompt:
      "A delivery tracking app: drivers update their position, customers see live driver location on a Mapbox map, ETA, and order status. Realtime via Supabase channels.",
    Icon: Map,
    accent: "mint",
    category: "Maps & geo",
  },
  {
    title: "Travel itinerary planner",
    prompt:
      "A trip planner: add destinations to a day-by-day itinerary, see them pinned on a Mapbox map with route lines, attach notes and photos per stop, share read-only link with friends.",
    Icon: Globe,
    accent: "butter",
    category: "Maps & geo",
  },

  // ── Audio & video ───────────────────────────────────────────────────────
  {
    title: "Podcast site (with player)",
    prompt:
      "A podcast website: hero, episode list pulled from a database, /episodes/$slug page with embedded audio player and shownotes, RSS feed at /rss.xml, subscribe-via newsletter form.",
    Icon: Mic,
    accent: "lilac",
    category: "Audio & video",
    featured: true,
  },
  {
    title: "Video course platform",
    prompt:
      "A video course platform: course catalog, lesson list per course, video player (Mux or HTML5), progress tracking per user, Stripe one-time purchase to unlock a course, simple admin to upload lessons.",
    Icon: Video,
    accent: "pink",
    category: "Audio & video",
  },
  {
    title: "Voice transcription tool",
    prompt:
      "Upload an audio file or record in-browser, AI transcribes it (use OpenAI Whisper or similar), show timestamped transcript, allow edits, export as TXT/SRT. Save transcripts per user.",
    Icon: Mic,
    accent: "mint",
    category: "Audio & video",
  },
  {
    title: "Live video room (Daily.co)",
    prompt:
      "A 1-click video meeting tool: create a room, share the link, up to 10 people join with camera/mic, screen share. Use Daily.co's prebuilt component. Track meeting history per user.",
    Icon: Video,
    accent: "sky",
    category: "Audio & video",
  },

  // ── Extensions / embeds ─────────────────────────────────────────────────
  {
    title: "Embeddable chat widget",
    prompt:
      "A customer-support chat widget that any site can embed with a single <script> tag. Floating bubble bottom-right, opens to chat panel, messages routed to my admin inbox in this project. Realtime.",
    Icon: MessageSquare,
    accent: "lilac",
    category: "Extensions",
    featured: true,
  },
  {
    title: "Browser extension (Chrome MV3)",
    prompt:
      "A Chrome extension scaffold (Manifest V3): popup UI, content script that adds a button to any webpage, background service worker, options page. Build it so I can load unpacked and iterate.",
    Icon: Puzzle,
    accent: "butter",
    category: "Extensions",
  },
  {
    title: "Embeddable testimonials widget",
    prompt:
      "A testimonials manager: I collect testimonials in an admin, then embed a beautiful rotating-quotes widget on any site via a <script> tag. Light/dark themes auto-detect.",
    Icon: Sparkles,
    accent: "pink",
    category: "Extensions",
  },

  // ── AI agents / workflow ────────────────────────────────────────────────
  {
    title: "AI agent / workflow builder",
    prompt:
      "A visual workflow builder: drag steps onto a canvas (HTTP request, AI step, condition, send email), connect them, run the workflow on a trigger or schedule. Save/load workflows per user. Use React Flow.",
    Icon: Workflow,
    accent: "lilac",
    category: "AI tools",
    featured: true,
  },
  {
    title: "AI research agent",
    prompt:
      "Give the AI a research question; it searches the web (Perplexity API), reads the top sources, and returns a structured report with citations. Save reports per user.",
    Icon: Brain,
    accent: "sky",
    category: "AI tools",
  },
  {
    title: "AI email triage assistant",
    prompt:
      "Connect a Gmail inbox; AI categorises incoming emails (Action, FYI, Newsletter, Spam), drafts replies for Action items, and shows a daily digest. Approve-to-send for replies.",
    Icon: Inbox,
    accent: "mint",
    category: "AI tools",
  },
];

export const FEATURED_IDEAS = START_IDEAS.filter((i) => i.featured);
