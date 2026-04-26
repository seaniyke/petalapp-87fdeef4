import { useEffect, useState, type ReactNode } from "react";

type SampleApp = {
  slug: string;
  title: string;
  chat: { from: "user" | "petal"; text: ReactNode; tint?: string }[];
  fileName: string;
  code: string;
  preview: ReactNode;
};

const SAMPLES: SampleApp[] = [
  {
    slug: "habit-tracker",
    title: "petal — habit-tracker",
    chat: [
      { from: "user", text: "Make a minimalist habit tracker with confetti when I complete one." },
      {
        from: "petal",
        tint: "bg-butter/60",
        text: (
          <>
            Done — added <code className="font-mono">app.js</code>, hooked up confetti, and styled with pastel cards.
          </>
        ),
      },
      { from: "user", text: "Add a streak counter please." },
    ],
    fileName: "index.html",
    code: `<!doctype html>
<html>
  <body class="bg-cream">
    <h1>Today's habits</h1>
    <ul id="habits"></ul>
    <script src="app.js"></script>
  </body>
</html>`,
    preview: (
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
                className={`h-5 w-5 rounded-full ${h.on ? "bg-mint" : "border border-border"}`}
              />
            </li>
          ))}
        </ul>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-coral/20 px-3 py-1 text-xs">
          🔥 7 day streak
        </div>
      </div>
    ),
  },
  {
    slug: "pomodoro",
    title: "petal — pomodoro",
    chat: [
      { from: "user", text: "A pastel pomodoro timer with stats and a soft chime." },
      {
        from: "petal",
        tint: "bg-mint/50",
        text: (
          <>
            Built it — <code className="font-mono">timer.js</code> handles the loop, stats live in localStorage.
          </>
        ),
      },
      { from: "user", text: "Make the circle bigger." },
    ],
    fileName: "timer.js",
    code: `let seconds = 25 * 60;
const tick = () => {
  if (--seconds <= 0) chime();
  render(seconds);
};
setInterval(tick, 1000);`,
    preview: (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 font-display text-2xl">Focus</div>
        <div className="mx-auto grid h-32 w-32 place-items-center rounded-full border-4 border-lilac/60 bg-lilac/10">
          <span className="font-display text-3xl tabular-nums">24:51</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          {[
            { l: "Today", v: "3" },
            { l: "Streak", v: "5d" },
            { l: "Total", v: "42" },
          ].map((s) => (
            <div key={s.l} className="rounded-xl bg-background px-2 py-2">
              <div className="font-display text-base">{s.v}</div>
              <div className="text-muted-foreground">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    slug: "recipes",
    title: "petal — recipe-finder",
    chat: [
      { from: "user", text: "A recipe generator with photos and ingredient lists." },
      {
        from: "petal",
        tint: "bg-coral/30",
        text: (
          <>
            Wired up <code className="font-mono">recipes.json</code> with images and a search input.
          </>
        ),
      },
      { from: "user", text: "Show prep time on each card." },
    ],
    fileName: "recipes.json",
    code: `[
  {
    "title": "Miso Carrot Soup",
    "time": "20 min",
    "tags": ["vegan", "easy"]
  }
]`,
    preview: (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-xl">Tonight</div>
          <span className="rounded-full bg-sky/40 px-2 py-0.5 text-[10px]">vegan</span>
        </div>
        <div className="mb-3 h-24 rounded-xl bg-gradient-to-br from-butter via-coral/40 to-lilac/50" />
        <div className="text-sm font-semibold">Miso Carrot Soup</div>
        <div className="mt-1 text-xs text-muted-foreground">20 min · 4 servings</div>
        <ul className="mt-3 space-y-1 text-xs">
          {["6 carrots", "1 tbsp miso", "thumb of ginger"].map((i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-coral" /> {i}
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    slug: "coffee-shop",
    title: "petal — bean-and-leaf",
    chat: [
      { from: "user", text: "A landing page for my coffee shop, warm and inviting." },
      {
        from: "petal",
        tint: "bg-butter/60",
        text: (
          <>
            Created <code className="font-mono">index.html</code> with a hero, menu, and hours.
          </>
        ),
      },
      { from: "user", text: "Add a 'reserve a table' button." },
    ],
    fileName: "index.html",
    code: `<section class="hero">
  <h1>Bean & Leaf</h1>
  <p>Slow coffee. Quiet mornings.</p>
  <a href="#menu">See menu</a>
</section>`,
    preview: (
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="bg-gradient-to-br from-coral/30 via-butter to-mint/30 p-5">
          <div className="font-display text-2xl leading-tight">Bean & Leaf</div>
          <p className="mt-1 text-xs text-muted-foreground">Slow coffee. Quiet mornings.</p>
          <button className="mt-3 rounded-full bg-foreground px-3 py-1.5 text-[11px] text-background">
            Reserve a table
          </button>
        </div>
        <ul className="divide-y divide-border text-sm">
          {[
            { n: "Flat white", p: "$4.20" },
            { n: "Pour over", p: "$5.00" },
            { n: "Matcha latte", p: "$5.50" },
          ].map((m) => (
            <li key={m.n} className="flex items-center justify-between px-4 py-2">
              <span>{m.n}</span>
              <span className="font-mono text-xs text-muted-foreground">{m.p}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
];

const ROTATE_MS = 5500;

export function SampleAppShowcase() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SAMPLES.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const sample = SAMPLES[index];

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-coral" />
          <span className="h-3 w-3 rounded-full bg-butter" />
          <span className="h-3 w-3 rounded-full bg-mint" />
          <span
            key={`title-${sample.slug}`}
            className="ml-3 font-mono text-xs text-muted-foreground animate-fade-in"
          >
            {sample.title}
          </span>
        </div>

        {/* Body — keyed so each panel remounts and re-runs the entrance animation */}
        <div
          key={sample.slug}
          className="grid gap-0 md:grid-cols-[260px_1fr_1.1fr]"
        >
          {/* Chat */}
          <div className="border-b border-border bg-sidebar p-4 text-sm md:border-b-0 md:border-r animate-fade-in">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Chat
            </div>
            <div className="space-y-3">
              {sample.chat.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-3 text-xs text-foreground/80 ${
                    m.tint ?? "bg-card"
                  }`}
                  style={{ animation: `fade-in 0.5s ease-out ${i * 90}ms backwards` }}
                >
                  {m.text}
                </div>
              ))}
            </div>
          </div>

          {/* Code */}
          <div className="border-b border-border bg-background/50 p-4 font-mono text-[11px] leading-relaxed text-foreground/80 md:border-b-0 md:border-r animate-fade-in">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {sample.fileName}
            </div>
            <pre className="whitespace-pre-wrap">{sample.code}</pre>
          </div>

          {/* Preview */}
          <div className="bg-aurora p-6 animate-fade-in">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Preview
            </div>
            <div className="animate-scale-in">{sample.preview}</div>
          </div>
        </div>
      </div>

      {/* Indicators */}
      <div className="mt-6 flex items-center justify-center gap-2">
        {SAMPLES.map((s, i) => {
          const active = i === index;
          return (
            <button
              key={s.slug}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show ${s.slug}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                active ? "w-8 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/40"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
