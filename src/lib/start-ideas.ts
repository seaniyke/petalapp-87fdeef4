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
  | "Extensions";

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
];

export const FEATURED_IDEAS = START_IDEAS.filter((i) => i.featured);
