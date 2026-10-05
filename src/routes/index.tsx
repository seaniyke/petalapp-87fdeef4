import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { PetalBrand } from "@/components/PetalBrand";
import { StartIdeasPanel } from "@/components/StartIdeasPanel";
import { ComposerModePicker, type ComposerMode } from "@/components/ComposerModePicker";
import { IdeaCoach } from "@/components/IdeaCoach";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";
import { useMarketplaceFeature } from "@/hooks/use-marketplace-feature";

import type { BuildTargetId } from "@/lib/build-targets";
import { INVEST_LINKS_ENABLED } from "@/lib/site-flags";

import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { listProjects, listPublicProjects, isProjectPublic, type ProjectRow } from "@/lib/projects";
import {
  ArrowRight,
  ArrowUp,
  FolderPlus,
  Paperclip,
  Camera,
  X,
  Globe,
  Lock,
  Plus,
  Mic,
  Code2,
  ShieldCheck,
  Store,
  Sparkles,
  Home,
  LayoutGrid,
  MessageSquareText,
} from "lucide-react";
import { toVisitorSummary } from "@/lib/visitor-summary";

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
      { title: "Kimble — Build it and ship it" },
      {
        name: "description",
        content:
          "Kimble is an app builder for the web. Describe your idea, build it, and publish it.",
      },
      { property: "og:title", content: "Kimble — Build it and ship it" },
      {
        property: "og:description",
        content: "Describe your app, build it, and publish it. Your code is yours, and credits never expire.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const samplePrompts = [
  "A web app with sign-in and a dashboard",
  "A landing page for my coffee shop",
];

// Key for stashing the in-progress landing draft so a refresh — or a detour
// through /auth — doesn't wipe what the user just typed. sessionStorage so
// it doesn't linger across browser sessions; the user clearly wanted *now*.
const DRAFT_KEY = "petal:landing:draft";

function Landing() {
  const { enabled: marketplaceEnabled } = useMarketplaceFeature();
  const { focus: focusParam } = Route.useSearch();
  const [prompt, setPrompt] = useState("");
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [mode, setMode] = useState<ComposerMode>("build");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [buildTarget, setBuildTarget] = useState<BuildTargetId>("web");
  // Baseline captured on dictation start so partial transcripts append to
  // (not replace) what the user already typed.
  const dictationBaseRef = useRef("");
  const voice = useVoiceDictation({
    onText: (text, isFinal) => {
      const base = dictationBaseRef.current;
      const merged = base ? `${base} ${text}`.replace(/\s+/g, " ").trimStart() : text;
      setPrompt(merged);
      if (isFinal) dictationBaseRef.current = merged;
    },
    getAuthToken: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, isReady, likelyAuthed } = useAuth();
  const isAuthed = !!user;
  // The marketing page must never wait on the auth round-trip. Signed-out
  // visitors (the overwhelming majority, and every crawler) get real content
  // on the very first frame; returning users are detected optimistically from
  // their stored token so they don't see the marketing hero flash.
  const showAuthedHero = isReady ? isAuthed : likelyAuthed;
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
  // before the user's first name (e.g. "Dream big, Ikechukwu."). Picked once
  // AFTER mount — choosing during render made the server and client disagree
  // and React threw away the hydrated tree (visible flash on first paint).
  const [heroGreeting, setHeroGreeting] = useState("Dream big,");
  useEffect(() => {
    const greetings = ["Dream big,", "Let's build,", "Make magic,", "Ship it,", "What's next,"];
    setHeroGreeting(greetings[Math.floor(Math.random() * greetings.length)]);
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

  // Public work is the most honest proof on the signed-out homepage, and also
  // powers the Public filter for returning users.
  useEffect(() => {
    if (showAuthedHero && projectFilter !== "public") return;
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
  }, [projectFilter, communityPublic, showAuthedHero]);

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
    // If the visitor started typing into the server-rendered textarea before
    // React hydrated, the DOM already holds text that state doesn't know
    // about. Adopt it instead of blanking the box out from under them.
    const typedBeforeHydration = textareaRef.current?.value ?? "";
    if (typedBeforeHydration.length > 0) {
      setPrompt(typedBeforeHydration);
      return;
    }
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
        mode === "discuss" ? "Ask Kimble anything…" : "Describe the app or website you want…",
      );
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prefix = mode === "discuss" ? "Ask Kimble about " : "Ask Kimble to build ";
    const restingPlaceholder =
      mode === "discuss" ? "Ask Kimble anything about your idea…" : "Describe the app or website you want…";
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
    // data-auth-hint-hide: a pre-paint script flags returning users (stored
    // session token) on <html>; CSS keeps this tree invisible until
    // AuthProvider resolves the session, so the marketing hero never flashes.
    <div data-auth-hint-hide className="landing-page min-h-screen bg-background text-foreground">
      <SiteHeader />

      {showAuthedHero && (
        <nav
          aria-label="Quick navigation"
          className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-[min(19rem,calc(100%-6rem))] items-center justify-between rounded-full border border-border/60 bg-card/70 p-1.5 shadow-[var(--shadow-squircle)] backdrop-blur-2xl md:hidden"
        >
          <Link to="/" className="grid h-12 flex-1 place-items-center rounded-full bg-foreground/10 text-foreground" aria-label="Home">
            <Home className="h-6 w-6" strokeWidth={2} />
          </Link>
          <Link to="/projects" className="grid h-12 flex-1 place-items-center rounded-full text-foreground/80" aria-label="Projects">
            <LayoutGrid className="h-6 w-6" strokeWidth={1.75} />
          </Link>
          <button
            type="button"
            onClick={() => {
              setMode("discuss");
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            className="grid h-12 flex-1 place-items-center rounded-full text-foreground/80"
            aria-label="Chat with Kimble"
          >
            <MessageSquareText className="h-6 w-6" strokeWidth={1.75} />
          </button>
        </nav>
      )}

      {/* Product-first hero */}
      <section className="relative flex min-h-[calc(100svh-3.5rem)] flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[image:var(--gradient-aura)]" aria-hidden />
        <div
          className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 pb-36 pt-24 text-center sm:px-6 sm:pt-32"
        >
          {showAuthedHero ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode("discuss");
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
                className="mx-auto mb-10 inline-flex items-center gap-3 rounded-full border border-border bg-card/70 py-1.5 pl-1.5 pr-4 text-sm font-medium backdrop-blur-xl transition hover:bg-card"
              >
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">New</span>
                Chat with Kimble for free
                <ArrowRight className="h-4 w-4" />
              </button>
              <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-balance sm:text-5xl">
                {firstName ? `Got an idea, ${firstName}?` : "Got an idea?"}
              </h1>
            </>
          ) : (
            <>
              <h1 className="font-display text-[2.1rem] font-bold leading-[1.05] tracking-tight text-balance sm:text-6xl">
                Build a business with Kimble
              </h1>
            </>
          )}


          {/* Prompt box — large chat-style composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mx-auto mt-8 w-full max-w-3xl sm:mt-10"
          >
            <div className="group relative rounded-[1.75rem] border border-border/70 bg-card/85 p-4 text-left shadow-[var(--shadow-squircle)] backdrop-blur-2xl transition focus-within:border-primary/50">
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
                        ? "Ask Kimble anything about your idea…"
                        : "Describe the app or website you want…"
                      : animatedPlaceholder
                  }
                  className="block w-full resize-none bg-transparent px-2 pb-16 pt-1 text-lg leading-relaxed outline-none placeholder:text-muted-foreground/80 sm:text-xl"
                  style={{ minHeight: "6.5rem" }}
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
              <div className="absolute inset-x-4 bottom-3 flex items-center justify-between gap-2">
                <div className="flex items-center">
                  {mode !== "coach" && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="grid h-9 w-9 place-items-center rounded-xl text-foreground/80 transition hover:bg-muted hover:text-foreground"
                      aria-label="Attach a photo or screenshot"
                      title="Attach a photo or screenshot"
                    >
                      <Plus className="h-5 w-5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <ComposerModePicker value={mode} onChange={setMode} />
                  {mode !== "coach" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!voice.supported) {
                          window.location.href = "/builder?dictate=1";
                          return;
                        }
                        if (voice.listening) {
                          voice.stop();
                        } else {
                          dictationBaseRef.current = prompt.trim();
                          voice.start();
                        }
                      }}
                      className={`grid h-9 w-9 place-items-center rounded-xl transition ${
                        voice.listening
                          ? "bg-primary text-primary-foreground animate-pulse"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground"
                      }`}
                      aria-label={voice.listening ? "Stop dictation" : "Dictate with voice"}
                      aria-pressed={voice.listening}
                    >
                      <Mic className="h-5 w-5" strokeWidth={1.75} />
                    </button>
                  )}
                  {mode !== "coach" && prompt.trim() && (
                    <button
                      type="submit"
                      aria-label={mode === "discuss" ? "Ask Kimble" : "Build it"}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background transition hover:opacity-90"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>

          {!showAuthedHero && (
            <>
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
                    document.querySelector("form")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  });
                }}
              />
            </>
          )}
        </div>
      </section>

      {showAuthedHero ? (
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
                  ? communityPublic &&
                    communityPublic.length > 0 && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {communityPublic.length}
                      </span>
                    )
                  : projects &&
                    projects.length > 0 && (
                      <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {projects.length}
                      </span>
                    )}
              </div>

              {/* Filter chips — Lovable-style segmented pills */}
              {projects && projects.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1 text-xs">
                    {[
                      { id: "all" as const, label: "All" },
                      { id: "recent" as const, label: "Recent" },
                    ].map((opt) => {
                      const active = projectFilter === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setProjectFilter(opt.id)}
                          className={`rounded-full px-3 py-1.5 font-medium transition ${
                            active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
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
                // Community discovery: every public project across Kimble,
                // linked through to the read-only /p/$slug page (since the
                // current user doesn't own them).
                communityLoading || communityPublic === null ? (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-card/60" />
                    ))}
                  </div>
                ) : communityPublic.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
                    No public projects yet — be the first to share one.
                  </div>
                ) : (
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {communityPublic.slice(0, 9).map((p) => (
                      <Link
                        key={p.id}
                        to="/p/$slug"
                        params={{ slug: p.slug }}
                        className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card/80 transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-[var(--shadow-soft)]"
                      >
                        <div className="relative">
                          <ProjectThumbnail
                            projectId={p.id}
                            title={p.title}
                            subdomain={p.subdomain}
                            buildId={p.published_build_id ?? p.latest_build_id}
                            className="h-36 sm:h-40"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent" />
                          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
                            <Globe className="h-3 w-3" /> Public
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col p-5">
                          <h3 className="truncate font-display text-base font-semibold tracking-tight">{p.title}</h3>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {toVisitorSummary(p.summary, p.title)}
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
                    <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-card/60" />
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <div className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-border bg-card">
                    <FolderPlus className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="mt-5 font-display text-xl">Your workspace is empty</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    Describe the app or website you want in the box above — Kimble scaffolds it in seconds.
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
                        className="group flex h-full min-h-[16rem] flex-col items-start justify-between rounded-2xl border border-dashed border-border bg-card/30 p-5 text-left transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-card"
                      >
                        <span className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background text-muted-foreground transition group-hover:border-primary/60 group-hover:text-foreground">
                          <Plus className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-display text-lg font-semibold">New project</div>
                          <p className="mt-1 text-xs text-muted-foreground">Start from a single sentence.</p>
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
                          className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card/80 transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-[var(--shadow-soft)]"
                        >
                          <div className="relative">
                            <ProjectThumbnail
                              projectId={p.id}
                              title={p.title}
                              subdomain={p.subdomain}
                              buildId={p.published_build_id ?? p.latest_build_id}
                              className="h-36 sm:h-40"
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-card/80 via-transparent to-transparent" />
                            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
                              {isProjectPublic(p) ? (
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
                            <h3 className="truncate font-display text-base font-semibold tracking-tight">{p.title}</h3>
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
          <section id="showcase" className="px-5 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Made with Kimble</p>
                  <h2 className="heading-editorial mt-4 text-5xl sm:text-6xl">Real ideas. <em>Real builds.</em></h2>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                    Explore public projects made in Kimble. Open one, see it working, then make it your own.
                  </p>
                </div>
                <Link to="/gallery" className="inline-flex h-11 items-center gap-2 self-start rounded-md border border-foreground/20 px-5 text-sm font-semibold transition hover:bg-foreground hover:text-background sm:self-auto">
                  Explore the gallery <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              {communityLoading || communityPublic === null ? (
                <div className="mt-12 grid gap-5 md:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />)}
                </div>
              ) : communityPublic.length > 0 ? (
                <div className="mt-12 grid gap-5 md:grid-cols-3">
                  {communityPublic.slice(0, 3).map((project, index) => (
                    <Link key={project.id} to="/p/$slug" params={{ slug: project.slug }} className={`group block ${index === 0 ? "md:col-span-2 md:row-span-2" : ""}`}>
                      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-soft)] transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[var(--shadow-editorial)]">
                        <ProjectThumbnail projectId={project.id} title={project.title} subdomain={project.subdomain} buildId={project.published_build_id ?? project.latest_build_id} className={index === 0 ? "h-64 sm:h-80 md:h-[28rem]" : "h-40 md:h-[12rem]"} />
                        <div className="flex items-center justify-between gap-4 border-t border-border p-4">
                          <div className="min-w-0">
                            <h3 className="truncate font-display text-lg font-semibold">{project.title}</h3>
                            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{toVisitorSummary(project.summary, project.title)}</p>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-12 grid overflow-hidden rounded-lg border border-border bg-foreground text-background md:grid-cols-[0.8fr_1.2fr]">
                  <div className="p-8 sm:p-12">
                    <p className="text-xs uppercase tracking-[0.18em] text-background/60">A complete product</p>
                    <h3 className="font-display mt-4 text-3xl font-semibold">Not another empty prototype.</h3>
                    <p className="mt-4 text-sm leading-relaxed text-background/70">Kimble plans the full journey, builds every screen, connects the working parts, checks the result, and gets it ready to publish.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-background/15">
                    {["Plan", "Build", "Test", "Publish"].map((label, i) => <div key={label} className="bg-foreground p-7"><span className="text-xs text-background/50">0{i + 1}</span><p className="mt-8 font-display text-xl">{label}</p></div>)}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section id="how" className="border-y border-border bg-foreground px-5 py-20 text-background sm:px-6 sm:py-28">
            <div className="mx-auto max-w-6xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">A clear path from prompt to product</p>
              <h2 className="heading-editorial mt-4 max-w-3xl text-5xl sm:text-6xl">You describe it.<br /><em>Kimble does the heavy lifting.</em></h2>
              <ol className="mt-10 grid gap-8 md:grid-cols-3">
                {[
                  ["01", "Start with the outcome", "Describe who the app is for, what it should do, and how it should feel."],
                  ["02", "Shape it in conversation", "Watch the plan, pages, features, and checks come together. Ask for changes in plain language."],
                  ["03", "Put it in people’s hands", "Publish it, connect your web address, or export the code."],
                ].map(([number, title, body]) => (
                  <li key={number} className="border-t border-background/25 pt-5">
                    <span className="text-xs text-background/50">{number}</span>
                    <h3 className="font-landing-display mt-8 text-2xl font-semibold">{title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-background/65">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section id="pricing" className="px-5 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-2 md:items-center">
              <h2 className="font-landing-display text-4xl font-semibold leading-tight sm:text-6xl">Buy credits once.<br />Use them anytime.</h2>
              <div>
                <p className="max-w-lg text-base leading-relaxed text-muted-foreground">Credits never expire, no saved card is required, and turns that change nothing cost nothing.</p>
                <Link to="/why/$slug" params={{ slug: "pay-as-you-build" }} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold hover:text-primary">
                  See how pricing works <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>

          <section id="faq" className="border-t border-border px-5 py-20 sm:px-6 sm:py-24">
            <div className="mx-auto max-w-6xl">
              <h2 className="font-landing-display text-3xl font-semibold sm:text-4xl">Common questions</h2>
              <div className="mt-10 grid border-t border-border md:grid-cols-2">
                {[
                  ["Do I need to add a card?", "No. Buy credits only when you choose, using any available payment method."],
                  ["Do credits expire?", "No. Your unused balance stays available."],
                  ["Do I own the code?", "Yes. Sync it to Git, edit it, and deploy it elsewhere."],
                ].map(([question, answer]) => (
                  <div key={question} className="border-b border-border py-6 md:pr-10 md:odd:border-r md:even:pl-10">
                    <h3 className="font-landing-display text-base font-semibold">{question}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="px-5 pb-20 sm:px-6 sm:pb-28">
            <div className="mx-auto max-w-6xl border border-border bg-card px-6 py-14 text-center sm:px-10 sm:py-20">
              <h2 className="font-landing-display text-4xl font-semibold sm:text-5xl">Start with one sentence.</h2>
              <Link
                to="/auth"
                search={{ mode: "signup", redirect: undefined }}
                className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-semibold text-background transition hover:opacity-90"
              >
                Start building <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <footer className="border-t border-border bg-card/40">
            <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6 sm:py-16">
              {/* Brand block + entry CTA */}
              <div className="flex flex-col gap-8 border-b border-border pb-10 md:flex-row md:items-end md:justify-between">
                <div className="max-w-sm">
                  <Link to="/" aria-label="Kimble home" className="inline-flex">
                    <PetalBrand size="sm" />
                  </Link>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    Turn sentences into shipped products. Websites and web apps,
                    your code, credits that never expire.
                  </p>
                </div>
                <Link
                  to="/auth"
                  search={{ mode: "signup", redirect: undefined }}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-5 text-sm font-medium text-background shadow-[var(--shadow-soft)] ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:ring-foreground/20"
                >
                  Get started <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              {/* Link columns */}
              <div className="grid grid-cols-2 gap-8 py-10 text-sm sm:grid-cols-4">
                <div className="space-y-3">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    Product
                  </h3>
                  <ul className="space-y-2.5 text-muted-foreground">
                    <li><Link to="/gallery" className="transition-colors hover:text-foreground">Gallery</Link></li>
                    {marketplaceEnabled && <li><Link to="/marketplace" className="transition-colors hover:text-foreground">Marketplace</Link></li>}
                    <li><Link to="/changelog" className="transition-colors hover:text-foreground">What's new</Link></li>
                    <li><Link to="/docs" className="transition-colors hover:text-foreground">Docs</Link></li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    Company
                  </h3>
                  <ul className="space-y-2.5 text-muted-foreground">
                    <li><Link to="/features/$slug" params={{ slug: "web" }} className="transition-colors hover:text-foreground">Features</Link></li>
                    <li><Link to="/why/$slug" params={{ slug: "agent-board" }} className="transition-colors hover:text-foreground">Why Kimble</Link></li>
                    {INVEST_LINKS_ENABLED && <li><Link to="/invest" className="transition-colors hover:text-foreground">Invest</Link></li>}
                    <li><Link to="/coffee" className="transition-colors hover:text-foreground">Support us</Link></li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    Legal
                  </h3>
                  <ul className="space-y-2.5 text-muted-foreground">
                    <li><Link to="/privacy" className="transition-colors hover:text-foreground">Privacy</Link></li>
                    <li><Link to="/terms" className="transition-colors hover:text-foreground">Terms</Link></li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    Build with Kimble
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Start from a single sentence — no setup, no lock-in.
                  </p>
                </div>
              </div>

              {/* Bottom bar */}
              <div className="flex flex-col items-center gap-3 border-t border-border pt-8 text-xs text-muted-foreground sm:flex-row sm:justify-between">
                <span>© {new Date().getFullYear()} Kimble</span>
                <span className="text-muted-foreground/70">
                  Powered by Kimble Cloud & Kimble AI
                </span>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
