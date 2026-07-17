import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms · Petal" },
      { name: "description", content: "The rules for using Petal." },
      { property: "og:title", content: "Terms · Petal" },
      { property: "og:description", content: "Petal's terms of service." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">Legal</p>
        <h1 className="mt-4 font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Effective January 1, 2026 · Last updated November 2026</p>

        <div className="prose prose-neutral mt-12 max-w-none dark:prose-invert prose-headings:font-display prose-headings:tracking-tight">
          <h2>1. Using Petal</h2>
          <p>
            By using Petal you agree to these terms. You must be at least 13 (or the age of digital
            consent in your country) and use Petal only for lawful purposes.
          </p>

          <h2>2. Your projects</h2>
          <p>
            You own the code Petal writes for you and everything you upload. We keep a limited licence
            to host, display, and back up your projects so the service can run.
          </p>

          <h2>3. Acceptable use</h2>
          <ul>
            <li>No malware, phishing, or fraud.</li>
            <li>No content that is illegal, harassing, or violates someone else's rights.</li>
            <li>No attempts to reverse-engineer or overload the service.</li>
          </ul>

          <h2>4. Billing</h2>
          <p>
            Free plans include a starting credit. Paid plans and top-ups are non-refundable except
            where required by law. Prices are shown on the plan you pick.
          </p>

          <h2>5. AI output</h2>
          <p>
            AI-generated code and content can be wrong, incomplete, or unsuitable for a specific use
            case. Always review what Petal ships before running it in production.
          </p>

          <h2>6. Termination</h2>
          <p>
            You can cancel any time. We can suspend accounts that break these terms. On termination we
            keep the minimum data required by law and delete the rest within 30 days.
          </p>

          <h2>7. Limitation of liability</h2>
          <p>
            Petal is provided “as is”. To the maximum extent permitted by law we're not liable for lost
            profits, data loss, or indirect damages arising from your use of the service.
          </p>

          <h2>8. Changes</h2>
          <p>
            We may update these terms. Material changes are announced in-app; continuing to use Petal
            after a change means you accept it.
          </p>

          <h2>9. Contact</h2>
          <p>
            <a href="mailto:hello@buildwithpetal.com">hello@buildwithpetal.com</a>
          </p>
        </div>

        <div className="mt-16 flex items-center justify-between border-t border-border/60 pt-8 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">← Read the Privacy Policy</Link>
          <Link to="/" className="hover:text-foreground">Back home →</Link>
        </div>
      </article>
    </div>
  );
}
