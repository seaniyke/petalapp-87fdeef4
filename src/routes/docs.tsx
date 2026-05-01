import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  Rocket,
  Cloud,
  Bot,
  Globe,
  Shield,
  CreditCard,
  MessageSquare,
  GitBranch,
  Wrench,
  HelpCircle,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation · Petal" },
      {
        name: "description",
        content:
          "Learn how to build, publish, and scale apps with Petal — from your first prompt to custom domains, backend, and AI features.",
      },
      { property: "og:title", content: "Petal Documentation" },
      {
        property: "og:description",
        content:
          "Guides for building full‑stack apps with Petal: prompts, Cloud, AI, publishing, custom domains, and billing.",
      },
    ],
  }),
  component: DocsPage,
});

type Section = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  body: React.ReactNode;
};

const sections: Section[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    icon: Rocket,
    blurb: "Go from idea to a live app in minutes.",
    body: (
      <>
        <p>
          Petal turns plain‑English prompts into a working full‑stack web app. The
          fastest way to learn is to build something tiny end‑to‑end.
        </p>
        <ol>
          <li>
            From the <Link to="/" className="underline">home page</Link>, describe what you want
            to build in one sentence — for example, "A landing page for a coffee shop with a
            menu and a contact form."
          </li>
          <li>
            Petal generates the project, opens the builder, and shows a live preview.
          </li>
          <li>
            Use the chat on the left to iterate. Be specific: name the page, the section, and
            the change you want.
          </li>
          <li>
            When you're happy, click <strong>Publish</strong> to take it live on a free
            <code>*.buildwithpetal.com</code> URL.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "prompting",
    title: "Prompting tips",
    icon: MessageSquare,
    blurb: "Get better results with focused, scoped requests.",
    body: (
      <>
        <p>
          Petal works best when each prompt is small and specific. Big "do everything" prompts
          tend to time out or drift off course.
        </p>
        <ul>
          <li><strong>One change per message.</strong> Ship it, then ask for the next thing.</li>
          <li><strong>Reference the surface.</strong> "On the pricing page, make the Pro card the highlighted plan."</li>
          <li><strong>Show, don't tell.</strong> Attach a screenshot for layout or style references.</li>
          <li><strong>Push back.</strong> If something looks off, say what's wrong and what you expected.</li>
          <li><strong>Use Chat mode</strong> for planning and questions; switch to Build mode to make changes.</li>
        </ul>
      </>
    ),
  },
  {
    id: "cloud",
    title: "Petal Cloud (backend)",
    icon: Cloud,
    blurb: "Database, auth, storage, and serverless functions.",
    body: (
      <>
        <p>
          Petal Cloud is the managed backend that powers data, users, file storage, and custom
          server logic. Enable it from the builder when you ask for anything that needs to
          persist across sessions.
        </p>
        <ul>
          <li><strong>Database</strong> — tables, rows, and queries managed for you.</li>
          <li><strong>Authentication</strong> — email/password and Google sign‑in.</li>
          <li><strong>Storage</strong> — secure file buckets for uploads.</li>
          <li><strong>Functions</strong> — server logic that scales automatically.</li>
          <li><strong>Secrets</strong> — store API keys safely, never in client code.</li>
        </ul>
        <p>
          Cloud and AI use a shared balance. New paid users get a one‑time
          <strong> $5 free runtime grant</strong> on their first plan upgrade or top‑up.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "Petal AI",
    icon: Bot,
    blurb: "Add AI features without managing API keys.",
    body: (
      <>
        <p>
          Petal AI gives your app access to top models without you needing to wire up API keys.
          Just ask Petal to add a chatbot, summarizer, classifier, or image analyzer and it will
          set up the calls for you.
        </p>
        <p>
          Common use cases: chatbots, document Q&A, sentiment detection, content generation,
          translation, and image analysis. Usage runs on your Cloud + AI balance.
        </p>
      </>
    ),
  },
  {
    id: "publish",
    title: "Publishing & updates",
    icon: Sparkles,
    blurb: "Take your app live and ship updates.",
    body: (
      <>
        <p>
          Click <strong>Publish</strong> in the builder to deploy. Your app gets a free
          <code> *.buildwithpetal.com</code> subdomain immediately.
        </p>
        <ul>
          <li><strong>Frontend changes</strong> require pressing "Update" in the publish dialog to go live.</li>
          <li><strong>Backend changes</strong> deploy automatically as soon as you publish.</li>
          <li>You can roll back to any earlier version from the builder's history panel.</li>
        </ul>
      </>
    ),
  },
  {
    id: "custom-domain",
    title: "Custom domains",
    icon: Globe,
    blurb: "Point your own domain at your Petal app.",
    body: (
      <>
        <p>
          Once you're on a paid plan, you can connect a custom domain from the publish sheet.
          Petal handles SSL automatically.
        </p>
        <ol>
          <li>Open <strong>Publish → Domains</strong>.</li>
          <li>Add the domain you own (e.g. <code>example.com</code>).</li>
          <li>Add the DNS records Petal shows you at your registrar.</li>
          <li>Wait a few minutes for verification — your site will go live on the new domain.</li>
        </ol>
      </>
    ),
  },
  {
    id: "auth-security",
    title: "Auth & security",
    icon: Shield,
    blurb: "Keep user data safe by default.",
    body: (
      <>
        <p>
          Petal apps use row‑level security so each user only sees their own data. Roles like
          "admin" live in a separate roles table, never on the profile, to prevent privilege
          escalation.
        </p>
        <p>
          For new sign‑ups, users verify their email before they can sign in. Google sign‑in
          is enabled by default for a smoother first‑run experience.
        </p>
      </>
    ),
  },
  {
    id: "billing",
    title: "Plans & billing",
    icon: CreditCard,
    blurb: "How credits, plans, and runtime work.",
    body: (
      <>
        <p>
          Petal has Free, Pro, Business, and Enterprise plans. Pro is the default and includes
          a monthly credit allowance. Each chat message in Build mode uses one credit; messages
          triggered by "Try to fix" are free.
        </p>
        <p>
          Backend, custom email, and custom domains require a paid plan. Top‑ups never expire
          and are independent from your monthly credit allowance.
        </p>
      </>
    ),
  },
  {
    id: "versioning",
    title: "Versions & rollback",
    icon: GitBranch,
    blurb: "Every change is a checkpoint you can revert.",
    body: (
      <>
        <p>
          Every Petal change creates a version. Open the history panel in the builder to
          preview, compare, or revert any earlier version — useful when an experiment didn't
          land the way you hoped.
        </p>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: Wrench,
    blurb: "When builds fail or the preview misbehaves.",
    body: (
      <>
        <ul>
          <li>
            <strong>Build error banner.</strong> Click "Try to fix" — it sends Petal the error
            and is free. If it loops, describe what you were trying to do and ask Petal to
            simplify the change.
          </li>
          <li>
            <strong>Preview is blank or stale.</strong> Hard‑refresh the preview, or open the
            published URL in a new tab.
          </li>
          <li>
            <strong>Backend feels slow.</strong> Increase the Cloud instance size from
            <em> Cloud → Overview → Advanced settings</em>. Allow a few minutes to apply.
          </li>
          <li>
            <strong>Stuck in an error loop.</strong> Stop, summarize the goal in one sentence,
            and ask Petal to take a different approach.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "faq",
    title: "FAQ",
    icon: HelpCircle,
    blurb: "Quick answers to the most common questions.",
    body: (
      <>
        <p><strong>Can I export my code?</strong> Yes — paid plans include code export and GitHub sync.</p>
        <p><strong>Can I export my database?</strong> Yes. Open the Cloud panel → Database → Tables and use the export action on the table you want.</p>
        <p><strong>How do I copy a project?</strong> Open the project, click its name in the top left, go to Settings, and choose Remix.</p>
        <p><strong>What does a credit cover?</strong> One Build‑mode message. Try‑to‑fix retries are free.</p>
        <p><strong>Where is my project ID?</strong> It's in the URL of the builder.</p>
      </>
    ),
  },
];

function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 pb-24 pt-10 md:pt-16">
        <header className="mb-10">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Documentation</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight md:text-5xl">
            Build anything with Petal
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
            Everything you need to go from a single prompt to a published, full‑stack app —
            with backend, AI, custom domains, and billing covered.
          </p>
        </header>

        <nav
          aria-label="On this page"
          className="mb-12 grid grid-cols-1 gap-2 rounded-2xl border border-border/60 bg-muted/30 p-4 sm:grid-cols-2 md:grid-cols-3"
        >
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-background"
              >
                <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <span>
                  <span className="block font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.blurb}</span>
                </span>
              </a>
            );
          })}
        </nav>

        <div className="space-y-14">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <section key={s.id} id={s.id} className="scroll-mt-24">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h2 className="font-serif text-2xl tracking-tight md:text-3xl">{s.title}</h2>
                </div>
                <div className="prose prose-neutral max-w-none text-[15px] leading-relaxed dark:prose-invert prose-p:my-3 prose-li:my-1 prose-ul:my-3 prose-ol:my-3 prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none">
                  {s.body}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="mt-20 rounded-2xl border border-border/60 bg-muted/30 p-6 text-center">
          <h3 className="font-serif text-xl">Still stuck?</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the builder and describe what you're trying to do — Petal can usually take it
            from there.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background"
          >
            Start building
          </Link>
        </footer>
      </main>
    </div>
  );
}
