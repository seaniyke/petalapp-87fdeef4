import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SampleAppShowcase } from "@/components/SampleAppShowcase";
import { useAuth } from "@/lib/auth";
import {
  ArrowRight,
  ArrowUp,
  MessageSquare,
  Code2,
  Eye,
  Rocket,
  Layers,
  Wand2,
  Paperclip,
  Github,
  Hammer,
  Camera,
  X,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Petal — Build real apps with AI" },
      {
        name: "description",
        content:
          "Petal turns conversations into working web apps. Chat, preview, and ship — no setup required.",
      },
      { property: "og:title", content: "Petal — Build real apps with AI" },
      {
        property: "og:description",
        content: "Turn conversations into working web apps in minutes.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d30d33f6-0e09-4310-a0fe-f6df9d9ede7b/id-preview-b2217a46--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app-1777186544019.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/d30d33f6-0e09-4310-a0fe-f6df9d9ede7b/id-preview-b2217a46--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app-1777186544019.png",
      },
    ],
  }),
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
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [mode, setMode] = useState<"build" | "discuss">("build");
  const [attachments, setAttachments] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  // Typewriter effect that cycles through samplePrompts. Pauses while the
  // textarea is focused or the user has typed anything, and respects
  // prefers-reduced-motion.
  useEffect(() => {
    if (isFocused || prompt.length > 0) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedPlaceholder(
        mode === "discuss" ? "Ask Petal anything…" : "Describe an app you want to build…",
      );
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prefix = mode === "discuss" ? "Ask Petal about " : "Ask Petal to build ";
    let promptIdx = 0;
    let charIdx = 0;
    let typingMode: "typing" | "pausing" | "deleting" = "typing";

    const tick = () => {
      if (cancelled) return;
      const target = samplePrompts[promptIdx % samplePrompts.length];
      const fullText = prefix + target.toLowerCase().replace(/^a /, "a ");

      if (typingMode === "typing") {
        charIdx++;
        setAnimatedPlaceholder(fullText.slice(0, charIdx));
        if (charIdx >= fullText.length) {
          typingMode = "pausing";
          timer = setTimeout(tick, 1600);
          return;
        }
        timer = setTimeout(tick, 45);
      } else if (typingMode === "pausing") {
        typingMode = "deleting";
        timer = setTimeout(tick, 30);
      } else {
        charIdx--;
        setAnimatedPlaceholder(fullText.slice(0, Math.max(charIdx, prefix.length)));
        if (charIdx <= prefix.length) {
          typingMode = "typing";
          promptIdx++;
          timer = setTimeout(tick, 250);
          return;
        }
        timer = setTimeout(tick, 22);
      }
    };

    timer = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isFocused, prompt, mode]);

  // Auto-grow textarea up to a max height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setAttachments((prev) => [...prev, ...files].slice(0, 5));
    e.target.value = "";
  };

  const submit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const params = new URLSearchParams({ prompt: trimmed });
    if (mode === "discuss") params.set("mode", "discuss");

    // Stash any attached images in sessionStorage so they survive the redirect
    // (URL would blow past 32KB instantly with even one screenshot). The
    // builder picks them up by `attachKey` on first send.
    if (attachments.length > 0) {
      try {
        const { encodeAttachments } = await import("@/lib/attachments");
        const encoded = await encodeAttachments(attachments);
        if (encoded.length > 0) {
          const key = `petal:attach:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
          sessionStorage.setItem(key, JSON.stringify(encoded));
          params.set("attachKey", key);
        }
      } catch (e) {
        console.warn("Could not encode attachments:", e);
      }
    }

    const target = `/builder?${params.toString()}`;
    if (!user) {
      window.location.href = `/auth?mode=signup&redirect=${encodeURIComponent(target)}`;
      return;
    }
    window.location.href = target;
  };


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
            Now in early access
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

          {/* Prompt box — large chat-style composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mx-auto mt-10 max-w-2xl"
          >
            <div className="group relative rounded-3xl border border-border bg-card/90 p-4 text-left shadow-[var(--shadow-glow)] backdrop-blur transition focus-within:border-primary focus-within:shadow-[var(--shadow-soft)]">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onFocus={() => {
                  setIsFocused(true);
                  setAnimatedPlaceholder("");
                }}
                onBlur={() => setIsFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={3}
                placeholder={
                  isFocused || prompt
                    ? mode === "discuss"
                      ? "Ask Petal anything about your idea…"
                      : "Describe an app you want to build…"
                    : animatedPlaceholder
                }
                className="block w-full resize-none bg-transparent px-2 pb-16 pt-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground/80"
                style={{ minHeight: "6rem" }}
              />

              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                  {attachments.map((file, idx) => (
                    <span
                      key={`${file.name}-${idx}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pl-2 pr-1 text-xs text-muted-foreground"
                    >
                      <Paperclip className="h-3 w-3" />
                      <span className="max-w-[120px] truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="grid h-4 w-4 place-items-center rounded-full hover:bg-foreground/10"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Hidden file inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleAttach}
                className="hidden"
              />

              {/* Bottom toolbar */}
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    aria-label="Attach a photo or screenshot"
                    title="Attach a photo or screenshot"
                  >
                    <Camera className="h-4 w-4" />
                  </button>

                  {/* Build / Discuss mode toggle */}
                  <div className="ml-1 inline-flex items-center rounded-full border border-border bg-background/60 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setMode("build")}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                        mode === "build"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      aria-pressed={mode === "build"}
                    >
                      <Hammer className="h-3 w-3" />
                      Build
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("discuss")}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
                        mode === "discuss"
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      aria-pressed={mode === "discuss"}
                      title="Chat first — Petal won't change any files"
                    >
                      <MessageSquare className="h-3 w-3" />
                      Discuss
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  aria-label={mode === "discuss" ? "Ask Petal" : "Build it"}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:brightness-105 disabled:opacity-50"
                  disabled={!prompt.trim()}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
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

      {/* Showcase — rotating sample apps */}
      <section id="showcase" className="relative -mt-16 px-6 pb-24">
        <SampleAppShowcase />
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
                title: "Frontier AI models",
                body: "Top-tier models built in — no API keys or setup required.",
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
          {user ? (
            <Link
              to="/projects"
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-base font-medium text-primary-foreground transition hover:brightness-105"
            >
              Open my projects
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link
              to="/auth"
              search={{ mode: "signup", redirect: undefined }}
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-base font-medium text-primary-foreground transition hover:brightness-105"
            >
              Start building free
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </section>

      <footer className="border-t border-border bg-card/40">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground md:flex-row">
          <div>© {new Date().getFullYear()} Petal. All rights reserved.</div>
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
