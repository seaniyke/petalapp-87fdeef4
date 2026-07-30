import { Link } from "@tanstack/react-router";
import {
  Code2,
  Braces,
  Database,
  Lock,
  Server,
  Cloud,
  GitBranch,
  Shield,
  Gauge,
  Globe,
  Scale,
  ScrollText,
  Check,
  X,
  Sparkles,
} from "lucide-react";

type StackRow = {
  icon: typeof Code2;
  label: string;
  tint: string;
};

/**
 * The twelve layers Petal actually handles. Order matters: it reads as a
 * descent from "the part everyone sees" down to "the part that keeps you up
 * at night".
 */
const STACK: StackRow[] = [
  { icon: Code2, label: "Frontend", tint: "bg-foreground text-background" },
  { icon: Braces, label: "APIs & backend logic", tint: "bg-sky text-foreground" },
  { icon: Database, label: "Database & storage", tint: "bg-mint text-foreground" },
  { icon: Lock, label: "Auth & permissions", tint: "bg-mint text-foreground" },
  { icon: Server, label: "Hosting & deployment", tint: "bg-butter text-foreground" },
  { icon: Cloud, label: "Cloud & compute", tint: "bg-butter text-foreground" },
  { icon: GitBranch, label: "Versions & rollback", tint: "bg-coral text-background" },
  { icon: Shield, label: "Security & RLS", tint: "bg-coral text-background" },
  { icon: Gauge, label: "Rate limiting", tint: "bg-primary text-primary-foreground" },
  { icon: Globe, label: "Caching & CDN", tint: "bg-lilac text-foreground" },
  { icon: Scale, label: "Scaling", tint: "bg-lilac text-foreground" },
  { icon: ScrollText, label: "Error tracking & logs", tint: "bg-sky text-foreground" },
];

const COMPARISON: { label: string; petal: boolean; others: boolean }[] = [
  { label: "Pretty frontend", petal: true, others: true },
  { label: "Real database + auth", petal: true, others: false },
  { label: "Ships mobile to your phone", petal: true, others: false },
  { label: "Security scan before you launch", petal: true, others: false },
  { label: "Readiness score, not vibes", petal: true, others: false },
  { label: "Pay-as-you-go, no lock-in", petal: true, others: false },
];

export function WholeStackSection() {
  return (
    <section id="whole-stack" className="relative overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
      <div
        className="pointer-events-none absolute -bottom-32 right-0 -z-10 h-80 w-80 rounded-full bg-primary/15 blur-3xl"
        aria-hidden
      />

      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary">No, seriously</p>
          <h2 className="mt-3 font-display text-4xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
            Everyone thinks it's
            <br />
            <span className="italic text-muted-foreground line-through decoration-primary decoration-4">
              just the frontend
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg font-medium text-muted-foreground">
            It never is. Here's the whole stack Petal handles for you — the twelve things that usually turn a weekend
            idea into a six-month project.
          </p>
        </div>

        <div className="mt-16 grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
          {/* What you think it takes */}
          <div className="rounded-[2rem] border border-border bg-card/60 p-6 sm:p-8">
            <h3 className="text-center text-lg font-black tracking-tight sm:text-xl">What you think it takes</h3>
            <div className="mt-6 space-y-3">
              <div className="flex h-40 items-center justify-center rounded-3xl bg-lilac/60 text-2xl font-black tracking-tight text-foreground sm:h-48 sm:text-3xl">
                Frontend
              </div>
              <div className="flex h-32 items-center justify-center rounded-3xl bg-sky/60 text-2xl font-black tracking-tight text-foreground sm:h-40 sm:text-3xl">
                Backend
              </div>
            </div>
            <p className="mt-6 text-center text-sm font-semibold text-muted-foreground">
              Two boxes. Two weekends. How hard could it be?
            </p>
          </div>

          {/* What Petal actually does */}
          <div className="rounded-[2rem] border border-border bg-foreground p-6 text-background shadow-[var(--shadow-editorial)] sm:p-8">
            <h3 className="text-center text-lg font-black tracking-tight sm:text-xl">What Petal actually does</h3>
            <ul className="mt-6 space-y-2">
              {STACK.map((row) => (
                <li
                  key={row.label}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${row.tint} ${row.tint === "bg-foreground text-background" ? "border border-background/20" : ""}`}
                >
                  <row.icon className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                  <span className="text-sm font-bold tracking-tight sm:text-base">{row.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center text-sm font-semibold text-background/70">
              Twelve layers. One chat. Zero DevOps tickets.
            </p>
          </div>
        </div>

        {/* Comparison strip */}
        <div className="mt-20 overflow-hidden rounded-[2rem] border border-border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 border-b border-border bg-muted/50 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] sm:px-8">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Petal vs frontend-only tools
            </span>
            <span className="text-center text-sm font-black tracking-tight text-primary">Petal</span>
            <span className="text-center text-sm font-bold tracking-tight text-muted-foreground">Others</span>
          </div>
          {COMPARISON.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 border-b border-border/60 px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] sm:px-8"
            >
              <span className="text-sm font-semibold tracking-tight sm:text-base">{row.label}</span>
              <span className="flex justify-center">
                {row.petal ? (
                  <Check className="h-5 w-5 text-primary" strokeWidth={3} aria-label="Yes" />
                ) : (
                  <X className="h-5 w-5 text-muted-foreground" strokeWidth={3} aria-label="No" />
                )}
              </span>
              <span className="flex justify-center">
                {row.others ? (
                  <Check className="h-5 w-5 text-muted-foreground" strokeWidth={3} aria-label="Yes" />
                ) : (
                  <X className="h-5 w-5 text-muted-foreground/50" strokeWidth={3} aria-label="No" />
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Readiness score — the signature differentiator */}
        <div className="mt-8 flex flex-col items-center gap-5 rounded-[2rem] border border-border bg-gradient-to-br from-primary/10 to-transparent p-7 text-center sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/15 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Only on Petal
          </span>
          <h3 className="max-w-2xl font-display text-3xl font-black leading-[1] tracking-[-0.03em] sm:text-4xl">
            A Readiness Score that tells you if it's actually launchable
          </h3>
          <p className="max-w-xl text-base font-medium text-muted-foreground">
            Security, auth, SEO, error states, RLS, responsiveness — scored out of 100 with a checklist you can fix in
            one tap. No other builder tells you the truth about your app.
          </p>
          <Link
            to="/docs"
            className="rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition hover:opacity-90"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
