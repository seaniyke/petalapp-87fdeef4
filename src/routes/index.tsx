import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SampleAppShowcase } from "@/components/SampleAppShowcase";
import { StartIdeasPanel } from "@/components/StartIdeasPanel";
import { ComposerModePicker, type ComposerMode } from "@/components/ComposerModePicker";
import { IdeaCoach } from "@/components/IdeaCoach";

import type { BuildTargetId } from "@/lib/build-targets";

import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { listProjects, listPublicProjects, type ProjectRow } from "@/lib/projects";
import {
  ArrowRight,
  ArrowUp,
  Eye,
  Rocket,
  Layers,
  Wand2,
  Paperclip,
  Github,
  Camera,
  X,
  Globe,
  Lock,
  Plus,
  Sparkles,
  Smartphone,
  Apple,
  Bot,
} from "lucide-react";

type ProjectFilter = "all" | "recent" | "public";

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LandingSearch = { focus?: "composer" };

export const Route = createFileRoute("/")({
  // Allow ?focus=composer so "+ New project" on /projects can land here and
  // immediately drop the cursor into the composer (avoids the empty
  // "Loading…" builder state — we only enter /builder once we have a prompt).
  validateSearch: (search: Record<string, unknown>): LandingSearch =>
    search.focus === "composer" ? { focus: "composer" } : {},
  head: () => ({
    meta: [
      { title: "Petal — Build web, mobile, backends & extensions by chatting" },
      {
        name: "description",
        content:
          "Petal turns a sentence into a real product. Web apps, mobile apps for iOS + Android, backends, and Chrome extensions — one chat, live preview, ship.",
      },
      { property: "og:title", content: "Petal — Build real software by chatting" },
      {
        property: "og:description",
        content: "One chat. Web, mobile, backend, or extension. Live preview, real files, shipped.",
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
  "A mobile habit tracker for iOS and Android",
  "A Chrome extension that summarises any page",
  "A backend API for a booking system",
  "A landing page for my coffee shop",
];

// Key for stashing the in-progress landing draft so a refresh — or a detour
// through /auth — doesn't wipe what the user just typed. sessionStorage so
// it doesn't linger across browser sessions; the user clearly wanted *now*.
const DRAFT_KEY = "petal:landing:draft";

function Landing() {
  const { focus: focusParam } = Route.useSearch();
  const [prompt, setPrompt] = useState("");
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("build");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [buildTarget, setBuildTarget] = useState<BuildTargetId>("web");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, isReady } = useAuth();
  const isAuthed = !!user;
  // Hydrate the profile display name synchronously from localStorage so a
  // refresh doesn't briefly show the email-derived fallback before the async
  // profile fetch resolves. We key by user id so switching accounts is safe.
  const profileCacheKey = user ? `petal:profile-name:${user.id}` : null;
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(() => {
    if (typeof window === "undefined" || !profileCacheKey) return null;
    try {
      return window.localStorage.getItem(profileCacheKey);
    } catch {
      return null;
    }
  });
  // Track whether we've finished the initial profile fetch for this user.
  // Until then, suppress the email-derived fallback to avoid the flash.
  const [profileFetched, setProfileFetched] = useState<boolean>(() => {
    if (typeof window === "undefined" || !profileCacheKey) return false;
    try {
      return window.localStorage.getItem(profileCacheKey) !== null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!user) {
      setProfileDisplayName(null);
      setProfileFetched(false);
      return;
    }
    // Re-hydrate from cache when the user changes (e.g. account switch).
    if (typeof window !== "undefined") {
      try {
        const cached = window.localStorage.getItem(`petal:profile-name:${user.id}`);
        setProfileDisplayName(cached);
        setProfileFetched(cached !== null);
      } catch {
        /* ignore */
      }
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }: { data: { display_name: string | null } | null }) => {
        if (cancelled) return;
        const name = data?.display_name ?? null;
        setProfileDisplayName(name);
        setProfileFetched(true);
        if (typeof window !== "undefined") {
          try {
            const key = `petal:profile-name:${user.id}`;
            if (name) window.localStorage.setItem(key, name);
            else window.localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);
  const firstName = useMemo(() => {
    if (profileDisplayName && profileDisplayName.trim()) {
      return profileDisplayName.trim().split(/\s+/)[0];
    }
    // Don't fall back to email-derived name until the profile fetch completes,
    // otherwise a user who set a custom display name sees their old email
    // handle flash on every refresh.
    if (!profileFetched) return "";
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const fromMeta =
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      (typeof meta.first_name === "string" && meta.first_name) ||
      "";
    if (fromMeta) return String(fromMeta).trim().split(/\s+/)[0];
    const email = user?.email ?? "";
    const local = email.split("@")[0] ?? "";
    if (!local) return "";
    return local.charAt(0).toUpperCase() + local.slice(1);
  }, [user, profileDisplayName, profileFetched]);

  // Curated set of 5 hero greetings. Edit this list to change what shows up
  // before the user's first name (e.g. "Dream big, Ikechukwu."). Picks one
  // at random per page load so it feels fresh without flickering mid-session.
  const heroGreeting = useMemo(() => {
    const greetings = [
      "Dream big,",
      "Let's build,",
      "Make magic,",
      "Ship it,",
      "What's next,",
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }, []);

  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  // Community-wide public projects, lazy-loaded the first time the user
  // clicks the "Public" filter chip. Separate state from `projects` so
  // switching back to All/Recent doesn't lose their own list.
  const [communityPublic, setCommunityPublic] = useState<ProjectRow[] | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  useEffect(() => {
    if (!isReady || !isAuthed) {
      setProjects(null);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isReady, isAuthed]);

  // Lazy-fetch the community Public list the first time the user opens it.
  useEffect(() => {
    if (projectFilter !== "public") return;
    if (communityPublic !== null) return;
    let cancelled = false;
    setCommunityLoading(true);
    listPublicProjects(60)
      .then((rows) => {
        if (!cancelled) setCommunityPublic(rows);
      })
      .catch(() => {
        if (!cancelled) setCommunityPublic([]);
      })
      .finally(() => {
        if (!cancelled) setCommunityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectFilter, communityPublic]);

  // When the user clicks "+ New project" on /projects we route them here with
  // ?focus=composer. Drop the cursor in the textarea and scroll it into view
  // so the composer is unmistakably the next thing to do.
  useEffect(() => {
    if (focusParam !== "composer") return;
    const t = window.setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [focusParam]);

  // Restore any draft the user had typed before refresh / auth redirect.
  // Runs once on mount; attachments aren't restored (Files can't survive a
  // reload) but the prompt + mode are by far the most painful losses.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { prompt?: string; mode?: ComposerMode };
      if (typeof parsed.prompt === "string" && parsed.prompt.length > 0) {
        setPrompt(parsed.prompt);
      }
      if (parsed.mode === "discuss" || parsed.mode === "build" || parsed.mode === "coach") {
        setMode(parsed.mode);
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, []);

  // Persist the draft as the user types/changes mode. Cleared on submit().
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (prompt.trim().length === 0) {
        sessionStorage.removeItem(DRAFT_KEY);
      } else {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt, mode }));
      }
    } catch {
      /* quota or disabled — fine, just lose the draft */
    }
  }, [prompt, mode]);

  // Typewriter effect that cycles through samplePrompts. Pauses while the
  // textarea is focused or the user has typed anything, and respects
  // prefers-reduced-motion.
  useEffect(() => {
    if (isFocused || prompt.length > 0) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedPlaceholder(
        mode === "discuss" ? "Ask Petal anything…" : "Describe a web app, mobile app, API or extension…",
      );
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prefix = mode === "discuss" ? "Ask Petal about " : "Ask Petal to build ";
    const restingPlaceholder =
      mode === "discuss"
        ? "Ask Petal anything about your idea…"
        : "Describe a web app, mobile app, API or extension…";
    let promptIdx = 0;
    let charIdx = 0;
    let typingMode: "typing" | "pausing" | "deleting" | "done" = "typing";
    // Cycle through the samples once, then settle on a calm static placeholder
    // so the input doesn't type/delete forever (it was distracting on mobile).
    const maxCycles = samplePrompts.length;

    const tick = () => {
      if (cancelled) return;
      if (typingMode === "done") {
        setAnimatedPlaceholder(restingPlaceholder);
        return;
      }
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
          promptIdx++;
          if (promptIdx >= maxCycles) {
            typingMode = "done";
            timer = setTimeout(tick, 200);
            return;
          }
          typingMode = "typing";
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

  const submit = async (overridePrompt?: string, opts?: { fromCoach?: boolean }) => {
    const trimmed = (overridePrompt ?? prompt).trim();
    if (!trimmed) return;
    const params = new URLSearchParams({ prompt: trimmed });
    if (mode === "discuss") params.set("mode", "discuss");
    if (opts?.fromCoach) params.set("source", "coach");
    if (buildTarget !== "web") params.set("target", buildTarget);


    // The draft is about to ride along on the URL — drop the local copy so
    // a future visit to the landing page doesn't pre-fill an old prompt.
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }

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
    // Unauthenticated path is safe to take immediately — we don't need
    // `isReady` to know we have to send them to signup. Gating on isReady
    // here was making the button look broken: if a user clicked before the
    // auth session finished hydrating, submit() returned silently and the
    // surrounding <form> fell back to its default GET, dumping them onto
    // "/?prompt=..." with no progress.
    if (isReady && user) {
      window.location.href = target;
      return;
    }
    if (isReady && !user) {
      window.location.href = `/auth?mode=signup&redirect=${encodeURIComponent(target)}`;
      return;
    }
    // Auth state not yet known — assume signed-out (the common case for
    // first-time visitors) and route them through signup. If they turn out
    // to be signed in, /auth will bounce them straight to `target` via its
    // own "already logged in" effect, so the prompt is never lost.
    window.location.href = `/auth?mode=signup&redirect=${encodeURIComponent(target)}`;
  };

  const goToAuthForCoach = () => {
    const target = `/?focus=composer`;
    window.location.href = `/auth?mode=signup&redirect=${encodeURIComponent(target)}`;
  };


  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Aurora + grain extend below the hero content so the warm wash
            covers more of the screen on mobile (echoing Lovable's full-bleed
            gradient feel) instead of cutting off right under the composer. */}
        <div className="absolute inset-x-0 top-0 bottom-[-12rem] bg-aurora opacity-80 sm:bottom-[-8rem]" aria-hidden />
        <div className="absolute inset-x-0 top-0 bottom-[-12rem] bg-grain opacity-40 sm:bottom-[-8rem]" aria-hidden />

        <div className={`relative mx-auto max-w-5xl px-5 text-center sm:px-6 ${!isReady || isAuthed ? "pt-40 pb-16 sm:pt-44 sm:pb-20 md:pt-48 md:pb-24" : "pt-32 pb-20 sm:pt-36 sm:pb-28 md:pt-40 md:pb-36"}`}>
          {!isReady ? (
            <div className="mx-auto h-[7.5rem] max-w-2xl animate-pulse rounded-3xl bg-card/50" aria-hidden="true" />
          ) : isAuthed ? (
            <h1 className="font-display text-[2rem] font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl md:text-6xl">
              {firstName ? (
                <>
                  {heroGreeting}{" "}
                  <span className="relative whitespace-nowrap">
                    <span className="relative z-10 italic">{firstName}</span>
                    <span
                      className="absolute -bottom-1 left-0 right-0 h-3 rounded-full bg-coral/50"
                      aria-hidden
                    />
                  </span>
                  .
                </>
              ) : (
                `${heroGreeting}.`
              )}
            </h1>
          ) : (
            <>
              <div className="mx-auto inline-flex flex-wrap items-center justify-center gap-2">
                <Link
                  to="/coffee"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-foreground backdrop-blur transition hover:border-primary/50 hover:text-primary"
                >
                  ☕ Buy us a coffee
                </Link>
              </div>

              <h1 className="mt-6 font-display text-[2.25rem] font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl md:text-7xl">
                Web, mobile, backend —{" "}
                <span className="relative whitespace-nowrap">
                  <span className="relative z-10 italic">just chat</span>
                  <span
                    className="absolute -bottom-1 left-0 right-0 h-3 rounded-full bg-coral/50"
                    aria-hidden
                  />
                </span>
                .
              </h1>

              <p className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-xl md:text-2xl">
                One sentence. A real app, mobile build, API, or Chrome extension — live in minutes.
              </p>

            </>
          )}

          {/* Prompt box — large chat-style composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mx-auto mt-10 max-w-2xl"
          >
            <div className="group relative rounded-3xl border border-border bg-card/90 p-4 text-left shadow-[var(--shadow-glow)] backdrop-blur transition focus-within:border-primary focus-within:shadow-[var(--shadow-soft)]">
              {mode === "coach" ? (
                <IdeaCoach
                  isAuthed={!!user}
                  onRequireSignIn={goToAuthForCoach}
                  onComplete={(p) => {
                    // Hand the assembled prompt back to the real composer in
                    // Build mode so the user can review/tweak before sending.
                    setMode("build");
                    setPrompt(p);
                    requestAnimationFrame(() => {
                      const el = textareaRef.current;
                      if (!el) return;
                      el.focus();
                      el.setSelectionRange(p.length, p.length);
                    });
                  }}
                />
              ) : (
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
                    // Enter inserts a newline (default). Cmd/Ctrl+Enter sends.
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={3}
                  placeholder={
                    isFocused || prompt
                      ? mode === "discuss"
                        ? "Ask Petal anything about your idea…"
                        : "Describe a web app, mobile app, API or extension…"
                      : animatedPlaceholder
                  }
                  className="block w-full resize-none bg-transparent px-2 pb-16 pt-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground/80"
                  style={{ minHeight: "6rem" }}
                />
              )}

              {/* Attachment chips — only relevant for build/discuss */}
              {mode !== "coach" && attachments.length > 0 && (
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
                <div className="flex flex-wrap items-center gap-1.5">

                  {mode !== "coach" && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      aria-label="Attach a photo or screenshot"
                      title="Attach a photo or screenshot"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  )}

                  <ComposerModePicker value={mode} onChange={setMode} />

                  {/* Build-target picker hidden on landing — selection still flows via builder. */}
                </div>

                {mode !== "coach" && (
                  <button
                    type="submit"
                    aria-label={mode === "discuss" ? "Ask Petal" : "Build it"}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:brightness-105 disabled:opacity-50"
                    disabled={!prompt.trim()}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                )}
              </div>

            </div>

          </form>

          {isReady && !isAuthed && (
            <StartIdeasPanel
              onPick={(p) => {
                setPrompt(p);
                requestAnimationFrame(() => {
                  const el = textareaRef.current;
                  if (!el) return;
                  el.focus();
                  el.setSelectionRange(p.length, p.length);
                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }}
              onSwitchToCoach={() => {
                setMode("coach");
                requestAnimationFrame(() => {
                  document
                    .querySelector("form")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }}
            />
          )}

        </div>
      </section>

      {!isReady ? null : isAuthed ? (
        <section className="relative px-5 pb-28 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            {/* Subtle divider — keeps the section visually separated from the
                composer above without a hard rule. */}
            <div className="mx-auto h-px max-w-xs bg-gradient-to-r from-transparent via-border to-transparent" />

            {/* Header row — title + count, with a quiet "View all" affordance */}
            <div className="mt-24 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mt-28">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-[1.75rem] font-semibold tracking-tight sm:text-4xl">
                  {projectFilter === "public" ? "Public projects" : "My projects"}
                </h2>
                {projectFilter === "public"
                  ? communityPublic && communityPublic.length > 0 && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {communityPublic.length}
                      </span>
                    )
                  : projects && projects.length > 0 && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {projects.length}
                      </span>
                    )}
              </div>

              {/* Filter chips — Lovable-style segmented pills */}
              {projects && projects.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1 text-xs">
                    {(
                      [
                        { id: "all" as const, label: "All" },
                        { id: "recent" as const, label: "Recent" },
                      ]
                    ).map((opt) => {
                      const active = projectFilter === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setProjectFilter(opt.id)}
                          className={`rounded-full px-3 py-1.5 font-medium transition ${
                            active
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <Link
                    to="/projects"
                    className="hidden h-8 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground transition hover:text-foreground sm:inline-flex"
                  >
                    View all
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>

            <div className="mt-8">
              {projectFilter === "public" ? (
                // Community discovery: every public project across Petal,
                // linked through to the read-only /p/$slug page (since the
                // current user doesn't own them).
                communityLoading || communityPublic === null ? (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-64 animate-pulse rounded-3xl border border-border bg-card/60"
                      />
                    ))}
                  </div>
                ) : communityPublic.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
                    No public projects yet — be the first to share one.
                  </div>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {communityPublic.slice(0, 9).map((p) => (
                      <Link
                        key={p.id}
                        to="/p/$slug"
                        params={{ slug: p.slug }}
                        className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card/80 transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-[var(--shadow-soft)]"
                      >
                        <div className="relative">
                          <ProjectThumbnail
                            projectId={p.id}
                            title={p.title}
                            subdomain={p.subdomain}
                            className="h-36 sm:h-40"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent" />
                          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
                            <Globe className="h-3 w-3" /> Public
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col p-5">
                          <h3 className="truncate font-display text-base font-semibold tracking-tight">
                            {p.title}
                          </h3>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {p.summary ?? "No description yet."}
                          </p>
                          <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                            <span>Updated {formatRelativeTime(p.updated_at)}</span>
                            <span className="inline-flex items-center gap-1 text-foreground/60 opacity-0 transition group-hover:opacity-100">
                              View
                              <ArrowRight className="h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )
              ) : projectsLoading || projects === null ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-64 animate-pulse rounded-3xl border border-border bg-card/60"
                    />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <div className="relative overflow-hidden rounded-3xl border border-dashed border-border bg-card/40 p-12 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-border bg-card">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="mt-5 font-display text-xl">Your workspace is empty</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    Describe a web app, mobile app, API or extension in the box
                    above — Petal scaffolds it in seconds.
                  </p>
                </div>
              ) : (
                (() => {
                  const visible = projects.slice(0, 6);
                  return (
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {/* "Start something new" card — first slot, mirrors Lovable */}
                      <button
                        type="button"
                        onClick={() => {
                          const el = textareaRef.current;
                          if (el) {
                            el.focus();
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                        className="group flex h-full min-h-[16rem] flex-col items-start justify-between rounded-3xl border border-dashed border-border bg-card/30 p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-card"
                      >
                        <span className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background text-muted-foreground transition group-hover:border-primary/60 group-hover:text-foreground">
                          <Plus className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-display text-lg font-semibold">
                            New project
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Start from a single sentence.
                          </p>
                        </div>
                      </button>

                      {visible.map((p) => (
                        <Link
                          key={p.id}
                          to="/builder"
                          search={{
                            id: p.id,
                            prompt: undefined,
                            mode: undefined,
                            attachKey: undefined,
                          }}
                          className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card/80 transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-[var(--shadow-soft)]"
                        >
                          <div className="relative">
                            <ProjectThumbnail
                              projectId={p.id}
                              title={p.title}
                              subdomain={p.subdomain}
                              className="h-36 sm:h-40"
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent" />
                            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
                              {p.is_public ? (
                                <>
                                  <Globe className="h-3 w-3" /> Public
                                </>
                              ) : (
                                <>
                                  <Lock className="h-3 w-3" /> Private
                                </>
                              )}
                            </span>
                          </div>
                          <div className="flex flex-1 flex-col p-5">
                            <h3 className="truncate font-display text-base font-semibold tracking-tight">
                              {p.title}
                            </h3>
                            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {p.summary ?? "No description yet."}
                            </p>
                            <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                              <span>Edited {formatRelativeTime(p.updated_at)}</span>
                              <span className="inline-flex items-center gap-1 text-foreground/60 opacity-0 transition group-hover:opacity-100">
                                Open
                                <ArrowRight className="h-3 w-3" />
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
      <section id="showcase" className="relative -mt-8 px-4 pb-16 sm:-mt-16 sm:px-6 sm:pb-24">
        <SampleAppShowcase />
      </section>

      {/* Mobile — Ship to iOS & Android */}
      <section id="mobile" className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-primary">
                One codebase, both stores
              </p>
              <h2 className="mt-2 font-display text-4xl font-black tracking-[-0.03em] sm:text-5xl md:text-6xl">
                Mobile apps without the Mac.
              </h2>
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                Tell Petal you want a mobile app and it scaffolds an Expo
                project that ships to iOS and Android from a single codebase.
                Preview in an iPhone or Android frame, scan a QR to test on
                your phone, then download a signed build — no Xcode, no
                Android Studio.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-coral/30">
                    <Apple className="h-4 w-4" />
                  </span>
                  <span>
                    <strong>iOS .ipa</strong> — TestFlight-ready. Built on
                    Petal's cloud, no Apple hardware needed.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-mint">
                    <Bot className="h-4 w-4" />
                  </span>
                  <span>
                    <strong>Android .apk / .aab</strong> — sideload to test,
                    upload to Play when you're ready.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-butter">
                    <Smartphone className="h-4 w-4" />
                  </span>
                  <span>
                    <strong>Test on phone in seconds</strong> — scan the QR,
                    open Expo Go, see your app live with hot reload.
                  </span>
                </li>
              </ul>
            </div>

            {/* Phone mockup */}
            <div className="relative mx-auto w-full max-w-[280px]">
              <div className="relative rounded-[2.5rem] border-[10px] border-foreground/90 bg-background shadow-[var(--shadow-soft)]">
                <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-foreground/90" />
                <div className="aspect-[9/19] overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-coral/20 via-butter to-mint/40 p-4 pt-10">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold">Your app</div>
                    <div className="h-2 w-2 rounded-full bg-coral" />
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-20 rounded-2xl bg-background/80 p-3">
                      <div className="h-2 w-1/2 rounded bg-foreground/20" />
                      <div className="mt-2 h-2 w-3/4 rounded bg-foreground/10" />
                      <div className="mt-2 h-2 w-2/3 rounded bg-foreground/10" />
                    </div>
                    <div className="h-16 rounded-2xl bg-background/80 p-3">
                      <div className="h-2 w-2/5 rounded bg-foreground/20" />
                      <div className="mt-2 h-2 w-3/4 rounded bg-foreground/10" />
                    </div>
                    <div className="h-16 rounded-2xl bg-background/80 p-3">
                      <div className="h-2 w-1/3 rounded bg-foreground/20" />
                      <div className="mt-2 h-2 w-1/2 rounded bg-foreground/10" />
                    </div>
                  </div>
                  {/* Bottom tab bar */}
                  <div className="absolute inset-x-4 bottom-4 flex items-center justify-around rounded-2xl bg-background/90 px-4 py-2 backdrop-blur">
                    <div className="h-5 w-5 rounded-md bg-coral/60" />
                    <div className="h-5 w-5 rounded-md bg-foreground/15" />
                    <div className="h-5 w-5 rounded-md bg-foreground/15" />
                    <div className="h-5 w-5 rounded-md bg-foreground/15" />
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-background">
                Built with Petal
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-wider text-primary">Why Petal</p>
            <h2 className="mt-2 font-display text-4xl font-black tracking-[-0.03em] sm:text-5xl md:text-6xl">One chat. Four targets. Real software.</h2>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Petal is a creative tool, not a code editor. Tell Petal what to
              build — a web app, mobile app, backend, or Chrome extension —
              in one sentence. Petal picks the right stack, runs a live
              preview, and ships it.
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Globe,
                tint: "bg-sky",
                title: "Web apps",
                body: "React + Tailwind, deployed to your own subdomain or custom domain.",
              },
              {
                icon: Smartphone,
                tint: "bg-coral/40",
                title: "Mobile apps",
                body: "One Expo codebase, ships to iOS and Android. QR-test on your phone.",
              },
              {
                icon: Layers,
                tint: "bg-mint",
                title: "Backends & APIs",
                body: "Typed server routes, database, auth and storage out of the box.",
              },
              {
                icon: Wand2,
                tint: "bg-lilac",
                title: "Chrome extensions",
                body: "Manifest V3 popup, background worker, content script — packaged.",
              },
              {
                icon: Eye,
                tint: "bg-butter",
                title: "Live preview",
                body: "Web frame, phone frame, or API console — whichever fits what you're building.",
              },
              {
                icon: Rocket,
                tint: "bg-coral/40",
                title: "Ship in one click",
                body: "Publish a public URL, download a build, or wire a custom domain.",
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
      <section id="how" className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-2 md:items-center md:gap-12">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-primary">How it works</p>
              <h2 className="mt-2 font-display text-4xl font-black tracking-[-0.03em] sm:text-5xl md:text-6xl">From idea to shipped, in three steps.</h2>
              <ol className="mt-8 space-y-6">
                {[
                  { n: "01", t: "Tell Petal what to build", d: "One sentence in plain English — a web app, mobile app, backend, or Chrome extension. No setup, no boilerplate." },
                  { n: "02", t: "Watch it come to life", d: "Petal researches, plans, writes the code, and streams a live preview in the matching frame while it works." },
                  { n: "03", t: "Refine, then ship", d: "Chat to iterate, edit by hand if you want, then publish a URL, wire a custom domain, or download a signed mobile build." },
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

      {/* Social proof — early builders */}
      <section id="testimonials" className="px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Early access</p>
            <h2 className="mt-3 font-display text-4xl font-black tracking-[-0.03em] sm:text-5xl md:text-6xl">
              Real people. Real apps.<br />Shipped this week.
            </h2>
            <p className="mt-5 text-base text-muted-foreground sm:text-lg">
              Petal is in early access. Here's what the first wave of
              builders — founders, designers, and non-coders — are saying.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                name: "Ada O.",
                role: "Founder, early access",
                quote:
                  "I described a booking app in one sentence. Ten minutes later I had a live URL I could send my first customer.",
                avatar: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=200&h=200&fit=crop&crop=faces&auto=format&q=80",
              },
              {
                name: "Samuel M.",
                role: "Product designer",
                quote:
                  "Told Petal to build a mobile app. It shipped an Expo project I could QR-scan on my phone. No Xcode, no fighting with Android Studio.",
                avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=faces&auto=format&q=80",
              },
              {
                name: "Kemi A.",
                role: "Non-technical solo builder",
                quote:
                  "I'd tried three other AI builders. Petal is the first one that actually finished the project — landing page, auth, database, the whole thing.",
                avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=200&h=200&fit=crop&crop=faces&auto=format&q=80",
              },
            ].map((t) => (
              <figure
                key={t.name}
                className="flex h-full flex-col justify-between rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:shadow-lg"
              >
                <blockquote className="font-display text-lg font-medium leading-snug tracking-[-0.01em] text-foreground">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3">
                  <img
                    src={t.avatar}
                    alt={t.name}
                    loading="lazy"
                    className="h-11 w-11 rounded-full object-cover ring-2 ring-border"
                  />
                  <div className="text-sm">
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>



        </div>
      </section>


      {/* CTA */}
      <section className="px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border bg-card p-6 text-center shadow-[var(--shadow-soft)] sm:p-12">
          <div className="absolute" />
          <h2 className="font-display text-4xl font-black tracking-[-0.03em] sm:text-5xl md:text-6xl">Your next product is one sentence away.</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Web, mobile, backend or extension — open Petal and describe it.
          </p>
          {!isReady ? null : user ? (
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
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row">
          <div>© {new Date().getFullYear()} Petal. All rights reserved.</div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/coffee" className="hover:text-foreground">Buy us a coffee</Link>
            <Link to="/invest" className="hover:text-foreground">Invest in Petal</Link>
            <a href="#" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Github className="h-4 w-4" /> GitHub
            </a>
            <a href="#" className="hover:text-foreground">Privacy</a>
            <a href="#" className="hover:text-foreground">Terms</a>
          </div>
        </div>
      </footer>
        </>
      )}
    </div>
  );
}
