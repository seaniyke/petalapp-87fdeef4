import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy · Petal" },
      { name: "description", content: "How Petal collects, uses, and protects your data." },
      { property: "og:title", content: "Privacy · Petal" },
      { property: "og:description", content: "Petal's privacy policy." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">Legal</p>
        <h1 className="mt-4 font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Effective January 1, 2026 · Last updated November 2026</p>

        <div className="prose prose-neutral mt-12 max-w-none dark:prose-invert prose-headings:font-display prose-headings:tracking-tight">
          <h2>1. Who we are</h2>
          <p>
            Petal (“we”, “us”) operates buildwithpetal.com and helps you build web apps, mobile apps,
            backends, and Chrome extensions from natural language. This policy explains what we collect
            and how we use it.
          </p>

          <h2>2. What we collect</h2>
          <ul>
            <li><strong>Account data</strong> — email, name, and (if you sign in with Google) your profile photo.</li>
            <li><strong>Project data</strong> — the prompts you send, the code Petal generates, and the files in your projects.</li>
            <li><strong>Usage data</strong> — pages you visit, features you use, and error reports needed to keep the product running.</li>
            <li><strong>Billing data</strong> — handled by our payment processors (Paystack, Stripe). We never see your full card number.</li>
          </ul>

          <h2>3. How we use it</h2>
          <p>
            To run the service, personalise your experience, secure your account, fix bugs, and improve
            Petal. We use aggregated, non-identifying signals to prioritise the roadmap.
          </p>

          <h2>4. AI model providers</h2>
          <p>
            Prompts and code snippets may be sent to model providers (OpenAI, Anthropic, Google, and our
            Petal AI Gateway) strictly to generate a response. We do not permit providers to train on
            your data.
          </p>

          <h2>5. Sharing</h2>
          <p>
            We share data only with the processors we need to run Petal (hosting, database, email,
            payments, analytics), under strict contracts. We never sell your data.
          </p>

          <h2>6. Your rights</h2>
          <p>
            You can export or delete your projects and account at any time from your profile. Email
            <a href="mailto:privacy@buildwithpetal.com"> privacy@buildwithpetal.com</a> for any
            data request.
          </p>

          <h2>7. Contact</h2>
          <p>
            Questions? <a href="mailto:hello@buildwithpetal.com">hello@buildwithpetal.com</a>.
          </p>
        </div>

        <div className="mt-16 flex items-center justify-between border-t border-border/60 pt-8 text-sm text-muted-foreground">
          <Link to="/terms" className="hover:text-foreground">Read the Terms →</Link>
          <Link to="/" className="hover:text-foreground">← Back home</Link>
        </div>
      </article>
    </div>
  );
}
