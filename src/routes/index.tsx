import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import {
  ArrowRight,
  MessageSquare,
  Code2,
  Eye,
  Rocket,
  Layers,
  Wand2,
  Github,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

const samplePrompts = [
  "A pastel pomodoro timer with stats",
  "A recipe generator with photos",
  "A landing page for my coffee shop",
  "A minimalist habit tracker",
];

function Landing() {
  const [prompt, setPrompt] = useState("");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
        <div className="absolute inset-0 bg-grain opacity-40" aria-hidden />

        <div className="relative mx-auto max-w-5xl px-6 pt-20 pb-28 text-center md:pt-28 md:pb-36">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Now in early access — powered by Lovable AI
          </div>

          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-balance md:text-7xl">
            Build real apps by{" "}
            <span className="relative whitespace-nowrap">
              <span className="relative z-10 italic">just chatting</span>
              <span
                className="absolute -bottom-1 left-0 right-0 h-3 rounded-full bg-coral/50"
                aria-hidden
              />
            </span>
            .
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground md:text-xl">
            Petal turns plain English into working web apps. Describe what you
            want, watch the files appear, and share a live preview in seconds.
          </p>

          {/* Prompt box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = encodeURIComponent(prompt.trim());
              window.location.href = `/builder${q ? `?prompt=${q}` : ""}`;
            }}
            className="mx-auto mt-10 max-w-2xl"
          >
            <div className="group relative rounded-2xl border border-border bg-card/90 p-2 shadow-[var(--shadow-glow)] backdrop-blur transition focus-within:border-primary">
              <div className="flex items-center gap-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-butter">
                  <Wand2 className="h-5 w-5 text-foreground/70" />
                </span>
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe an app you want to build…"
                  className="flex-1 bg-transparent px-1 py-2 text-base outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:brightness-105"
                >
                  Build it
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
              {samplePrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="rounded-full border border-border bg-card/60 px-3 py-1.5 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  {p}
                </button>
              ))}
            </div>
          </form>

          <div className="mt-10 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-mint" /> Live preview
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-lilac" /> Multi-file projects
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky" /> One-click share
            </span>
          </div>
        </div>
      </section>

      {/* Showcase / fake editor */}
      <section id="showcase" className="relative -mt-16 px-6 pb-24">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-coral" />
            <span className="h-3 w-3 rounded-full bg-butter" />
            <span className="h-3 w-3 rounded-full bg-mint" />
            <span className="ml-3 font-mono text-xs text-muted-foreground">petal — habit-tracker</span>
          </div>
          <div className="grid gap-0 md:grid-cols-[260px_1fr_1.1fr]">
            <div className="border-b border-border bg-sidebar p-4 text-sm md:border-b-0 md:border-r">
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Chat</div>
              <div className="space-y-3">
                <div className="rounded-xl bg-card p-3 text-xs text-foreground/80">Make a minimalist habit tracker with confetti when I complete one.</div>
                <div className="rounded-xl bg-butter/60 p-3 text-xs text-foreground/80">Done — added <code className="font-mono">app.js</code>, hooked up confetti, and styled with pastel cards.</div>
                <div className="rounded-xl bg-card p-3 text-xs text-foreground/80">Add a streak counter please.</div>
              </div>
            </div>
            <div className="border-b border-border bg-background/50 p-4 font-mono text-[11px] leading-relaxed text-foreground/80 md:border-b-0 md:border-r">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">index.html</div>
              <pre className="whitespace-pre-wrap">{`<!doctype html>
<html>
  <body class="bg-cream">
    <h1>Today's habits</h1>
    <ul id="habits"></ul>
    <script src="app.js"></script>
  </body>
</html>`}</pre>
            </div>
            <div className="bg-aurora p-6">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</div>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 font-display text-2xl">Today's habits</div>
                <ul className="space-y-2 text-sm">
                  {[
                    { l: "Drink water", on: true },
                    { l: "10 min walk", on: true },
                    { l: "Read 20 pages", on: false },
                  ].map((h) => (
                    <li
                      key={h.l}
                      className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2"
                    >
                      <span>{h.l}</span>
                      <span
                        className={`h-5 w-5 rounded-full ${
                          h.on ? "bg-mint" : "border border-border"
                        }`}
                      />
                    </li>
                  ))}
                </ul>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-coral/20 px-3 py-1 text-xs">
                  🔥 7 day streak
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-wider text-primary">Why Petal</p>
            <h2 className="mt-2 font-display text-4xl md:text-5xl">A creative tool, not a code editor.</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Petal is built around a conversation. You describe, it makes. You
              refine, it iterates. The files are real, the preview is live, and
              the result is yours.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: MessageSquare,
                tint: "bg-butter",
                title: "Chat-first building",
                body: "Plain language in, working app out. No prompts to memorize.",
              },
              {
                icon: Layers,
                tint: "bg-mint",
                title: "Multi-file projects",
                body: "Real HTML, CSS and JS files you can browse, edit and download.",
              },
              {
                icon: Eye,
                tint: "bg-lilac",
                title: "Live sandboxed preview",
                body: "Every change reloads instantly inside an isolated iframe.",
              },
              {
                icon: Code2,
                tint: "bg-sky",
                title: "Edit anything by hand",
                body: "Open the editor when you want to tweak something yourself.",
              },
              {
                icon: Rocket,
                tint: "bg-coral/40",
                title: "Ship in one click",
                body: "Share a public link the moment you're happy with it.",
              },
              {
                icon: Wand2,
                tint: "bg-butter",
                title: "Powered by Lovable AI",
                body: "Top frontier models, no API key wrangling required.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-card p-6 transition hover:-translate-y-1 hover:shadow-[var(--shadow-soft)]"
              >
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${f.tint}`}>
                  <f.icon className="h-5 w-5 text-foreground/80" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-primary">How it works</p>
              <h2 className="mt-2 font-display text-4xl md:text-5xl">From idea to app in three little steps.</h2>
              <ol className="mt-8 space-y-6">
                {[
                  { n: "01", t: "Describe what you want", d: "A page, a tool, a tiny game — say it like you'd tell a friend." },
                  { n: "02", t: "Petal generates the project", d: "Files appear in the explorer and the preview starts running." },
                  { n: "03", t: "Refine through chat", d: "Ask for changes, tweak code by hand, or both. Then share." },
                ].map((s) => (
                  <li key={s.n} className="flex gap-5">
                    <span className="font-display text-3xl text-primary">{s.n}</span>
                    <div>
                      <div className="text-lg font-semibold">{s.t}</div>
                      <p className="text-sm text-muted-foreground">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="relative">
              <div className="absolute -inset-8 -z-10 bg-aurora opacity-60 blur-2xl" aria-hidden />
              <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
                <div className="space-y-4 text-sm">
                  <div className="rounded-2xl bg-muted px-4 py-3">
                    <span className="text-muted-foreground">you · </span>
                    Make a calm meditation timer with breathing animation.
                  </div>
                  <div className="rounded-2xl bg-butter/60 px-4 py-3">
                    <span className="text-muted-foreground">petal · </span>
                    Created <code className="font-mono">index.html</code>, <code className="font-mono">styles.css</code>, <code className="font-mono">app.js</code>. Preview is live →
                  </div>
                  <div className="rounded-2xl bg-muted px-4 py-3">
                    <span className="text-muted-foreground">you · </span>
                    Make the circle bigger and add a soft chime at the end.
                  </div>
                  <div className="rounded-2xl bg-mint/60 px-4 py-3">
                    <span className="text-muted-foreground">petal · </span>
                    Updated <code className="font-mono">styles.css</code> and <code className="font-mono">app.js</code>. Reloading preview…
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border bg-card p-12 text-center shadow-[var(--shadow-soft)]">
          <div className="absolute" />
          <h2 className="font-display text-4xl md:text-5xl">Your next app is one sentence away.</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Open the builder, describe an idea, and watch it come to life.
          </p>
          <Link
            to="/builder"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-base font-medium text-primary-foreground transition hover:brightness-105"
          >
            Start building free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border bg-card/40">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground md:flex-row">
          <div>© {new Date().getFullYear()} Petal. Built with Lovable.</div>
          <div className="flex items-center gap-4">
            <a href="#" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Github className="h-4 w-4" /> GitHub
            </a>
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
