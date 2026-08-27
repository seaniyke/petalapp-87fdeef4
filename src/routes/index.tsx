import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SampleAppShowcase } from "@/components/SampleAppShowcase";
import { WholeStackSection } from "@/components/WholeStackSection";
import { StartIdeasPanel } from "@/components/StartIdeasPanel";
import { ComposerModePicker, type ComposerMode } from "@/components/ComposerModePicker";
import { IdeaCoach } from "@/components/IdeaCoach";
import { useVoiceDictation } from "@/hooks/use-voice-dictation";

import type { BuildTargetId } from "@/lib/build-targets";

import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { listProjects, listPublicProjects, isProjectPublic, type ProjectRow } from "@/lib/projects";
import {
  ArrowRight,
  ArrowUp,
  Eye,
  Rocket,
  Layers,
  Copy,
  Eye,
  FolderPlus,
  Puzzle,
  Paperclip,
  Camera,
  X,
  Globe,
  Lock,
  Plus,
  Smartphone,
  Star,
  ShieldCheck,
  Code2,
  Mic,
} from "lucide-react";

import webDashImg from "@/assets/landing-web-dashboard.jpg";
import backendImg from "@/assets/landing-backend.jpg";
import founderImg from "@/assets/landing-founder.jpg";
import phoneHandImg from "@/assets/landing-phone-hand.jpg";
import extensionImg from "@/assets/landing-extension.jpg";
import previewImg from "@/assets/landing-preview.jpg";
import shipImg from "@/assets/landing-ship.jpg";
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
      { title: "Petal — Build it, ship it, then sell it" },
      {
        name: "description",
        content:
          "Build web, mobile, backend or extension apps from one chat — then list them for sale. Credits you buy once and never lose, no subscription required.",
      },
      { property: "og:title", content: "Petal — Build it, ship it, then sell it" },
      {
        property: "og:description",
        content: "One chat builds it, eleven specialists review it, and the marketplace lets you sell it. Credits never expire.",
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
        mode === "discuss" ? "Ask Petal anything…" : "Describe a web app, mobile app, API or extension…",
      );
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const prefix = mode === "discuss" ? "Ask Petal about " : "Ask Petal to build ";
    const restingPlaceholder =
      mode === "discuss" ? "Ask Petal anything about your idea…" : "Describe a web app, mobile app, API or extension…";
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

        <div
          className={`relative mx-auto max-w-5xl px-5 text-center sm:px-6 ${showAuthedHero ? "pt-40 pb-16 sm:pt-44 sm:pb-20 md:pt-48 md:pb-24" : "pt-32 pb-20 sm:pt-36 sm:pb-28 md:pt-40 md:pb-36"}`}
        >
          {showAuthedHero ? (
            <h1 className="font-display text-[2rem] font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl md:text-6xl">
              {firstName ? (
                <>
                  {heroGreeting}{" "}
                  <span className="relative whitespace-nowrap">
                    <span className="relative z-10 italic">{firstName}</span>
                    <span className="absolute -bottom-1 left-0 right-0 h-3 rounded-full bg-coral/50" aria-hidden />
                  </span>
                  .
                </>
              ) : (
                // Without a first name the greeting's trailing comma would read
                // "Ship it,." — drop it so the sentence closes cleanly.
                `${heroGreeting.replace(/[,\s]+$/, "")}.`
              )}
            </h1>
          ) : (
            <>
              <div className="mx-auto inline-flex flex-wrap items-center justify-center gap-2">
                <Link
                  to="/why/$slug"
                  params={{ slug: "pay-as-you-build" }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-foreground backdrop-blur transition hover:border-primary/50 hover:text-primary"
                >
                  Credits that never expire — no subscription
                </Link>
              </div>

              {/* One statement, one accent. The italic line carries the
                  feeling; the roman line carries the promise. */}
              <h1 className="mt-7 font-display text-[3rem] font-black leading-[0.88] tracking-[-0.045em] text-balance sm:text-7xl md:text-[5.75rem]">
                Build it. Ship it.
                <br />
                <span className="italic font-normal text-primary">Then sell it.</span>
              </h1>

              <p className="mx-auto mt-6 max-w-lg text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
                Describe a web app, mobile app, backend or extension. Petal builds the real thing — and Petal is the
                only place you can put it up for sale when it's done.
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
            <div className="group relative rounded-2xl border border-border bg-card/90 p-4 text-left shadow-[var(--shadow-glow)] backdrop-blur transition focus-within:border-primary focus-within:shadow-[var(--shadow-soft)]">
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
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {mode !== "coach" && (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label="Attach a photo or screenshot"
                        title="Attach a photo or screenshot"
                      >
                        <Camera className="h-4 w-4" />
                      </button>
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
                        className={`grid h-9 w-9 place-items-center rounded-full transition ${
                          voice.listening
                            ? "bg-primary text-primary-foreground shadow-[var(--shadow-soft)] animate-pulse"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        aria-label={voice.listening ? "Stop dictation" : "Dictate with voice"}
                        aria-pressed={voice.listening}
                        title={voice.listening ? "Listening… click to stop" : "Dictate with voice"}
                      >
                        <Mic className="h-4 w-4" />
                      </button>
                    </>
                  )}

                  <ComposerModePicker value={mode} onChange={setMode} />

                  {/* Build-target picker hidden on landing — selection still flows via builder. */}
                </div>

                {mode !== "coach" && (
                  <button
                    type="submit"
                    aria-label={mode === "discuss" ? "Ask Petal" : "Build it"}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-soft)] transition hover:brightness-105 disabled:opacity-50"
                    disabled={!prompt.trim()}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </form>

          {!showAuthedHero && (
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
                // Community discovery: every public project across Petal,
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
                    Describe a web app, mobile app, API or extension in the box above — Petal scaffolds it in seconds.
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
          <section id="showcase" className="relative -mt-8 px-4 pb-16 sm:-mt-16 sm:px-6 sm:pb-24">
            <SampleAppShowcase />
          </section>

          {/* Proof strip — what Petal actually does, stated flat. No borrowed
              logos, no invented customer count. */}
          <section aria-label="What Petal covers" className="border-y border-border/60 bg-card/30">
            <div className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
                {[
                  { stat: "4", label: "Targets: web, mobile, backend, extension" },
                  { stat: "11", label: "Specialist agents review each build" },
                  { stat: "Never", label: "Credits expire" },
                  { stat: "80%", label: "You keep on marketplace sales" },
                ].map((s) => (
                  <div key={s.label}>
                    <dt className="font-display text-3xl font-black tracking-[-0.03em] sm:text-4xl">{s.stat}</dt>
                    <dd className="mt-1.5 max-w-[15rem] text-xs leading-relaxed text-muted-foreground">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          {/* THE DIFFERENCE — the four things only Petal does. Asymmetric on
              purpose: the marketplace claim gets the wide slot. */}
          <section id="difference" className="relative px-5 py-24 sm:px-6 sm:py-32">
            <div className="mx-auto max-w-6xl">
              <div className="max-w-3xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-primary">The difference</p>
                <h2 className="mt-4 font-display text-[2.75rem] font-black leading-[0.9] tracking-[-0.045em] sm:text-6xl md:text-7xl">
                  Everyone can generate an app.
                  <br />
                  <span className="italic font-normal">Four things they can't do.</span>
                </h2>
              </div>

              <div className="mt-16 grid gap-4 sm:grid-cols-5">
                {/* Wide slot — marketplace */}
                <Link
                  to="/why/$slug"
                  params={{ slug: "marketplace" }}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-[2rem] bg-foreground p-8 text-background sm:col-span-3 sm:p-10"
                >
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-background/50">01</span>
                    <h3 className="mt-5 font-display text-3xl font-black leading-[0.95] tracking-[-0.03em] sm:text-5xl">
                      Sell what you build.
                    </h3>
                    <p className="mt-4 max-w-md text-sm leading-relaxed text-background/70 sm:text-base">
                      List a finished project, set a price, transfer it to the buyer's workspace. Petal takes 20% and
                      nothing else. No other AI builder has a storefront on the other side of deploy.
                    </p>
                  </div>
                  <span className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-coral">
                    How the marketplace works
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>

                {/* Narrow slot — pay as you build */}
                <Link
                  to="/why/$slug"
                  params={{ slug: "pay-as-you-build" }}
                  className="group flex flex-col justify-between rounded-[2rem] border border-border bg-card p-8 sm:col-span-2 sm:p-10"
                >
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">02</span>
                    <h3 className="mt-5 font-display text-3xl font-black leading-[0.95] tracking-[-0.03em] sm:text-4xl">
                      Pay as you build.
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      Credit packs you buy once. They never expire, there is no plan to cancel, and a turn that changes
                      nothing costs nothing.
                    </p>
                  </div>
                  <span className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    See the pricing model
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>

                {/* Narrow slot — agent board */}
                <Link
                  to="/why/$slug"
                  params={{ slug: "agent-board" }}
                  className="group flex flex-col justify-between rounded-[2rem] border border-border bg-card p-8 sm:col-span-2 sm:p-10"
                >
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">03</span>
                    <h3 className="mt-5 font-display text-3xl font-black leading-[0.95] tracking-[-0.03em] sm:text-4xl">
                      A board, not a bot.
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      Product, architecture, design, security, QA — eleven specialists argue over the spec before a
                      single file is written.
                    </p>
                  </div>
                  <span className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    Meet the board
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>

                {/* Wide slot — own your code */}
                <Link
                  to="/why/$slug"
                  params={{ slug: "own-your-code" }}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-[2rem] border border-border bg-accent/40 p-8 sm:col-span-3 sm:p-10"
                >
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">04</span>
                    <h3 className="mt-5 font-display text-3xl font-black leading-[0.95] tracking-[-0.03em] sm:text-5xl">
                      The code is yours to take.
                    </h3>
                    <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                      Real React and TypeScript, two-way Git sync, your own domain. Leaving Petal should be a decision,
                      not an escape.
                    </p>
                  </div>
                  <span className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    What you actually own
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>
              </div>
            </div>
          </section>


          {/* Bento features — real product screenshots + editorial typography */}
          <section id="features" className="relative px-4 py-24 sm:px-6 sm:py-32">
            <div
              className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-coral/20 blur-3xl animate-blob"
              aria-hidden
            />
            <div className="mx-auto max-w-6xl">
              <div className="mx-auto max-w-3xl text-center">
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary">Why Petal</p>
                <h2 className="mt-3 font-display text-4xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
                  The whole stack.
                  <br />
                  <span className="italic text-primary">Shipped.</span>
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-lg font-medium text-muted-foreground">
                  Web, mobile, backends, Chrome extensions. Database, auth, hosting, security — Petal builds every layer
                  and puts it live. Not a mockup. A real app with a real URL.
                </p>

              </div>

              <div className="mt-16 grid gap-5 md:grid-cols-3">
                {/* Web app — now consistent with Mobile / Backend cards */}
                <Link
                  to="/features/$slug"
                  params={{ slug: "web" }}
                  className="group relative overflow-hidden rounded-[2rem] border border-border bg-foreground text-background shadow-[var(--shadow-editorial)]"
                >
                  <img
                    src={webDashImg}
                    alt="Petal-built SaaS dashboard on a laptop"
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-foreground/90 via-foreground/30 to-transparent" />
                  <div className="relative flex h-full min-h-[16rem] flex-col justify-end p-6">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-background/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
                      <Globe className="h-3 w-3" /> Web apps
                    </span>
                  </div>
                </Link>

                {/* Mobile */}
                <Link
                  to="/features/$slug"
                  params={{ slug: "mobile" }}
                  className="group relative overflow-hidden rounded-[2rem] border border-border bg-foreground text-background"
                >
                  <img
                    src={phoneHandImg}
                    alt="Mobile app built with Petal, held in hand"
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-foreground/90 via-foreground/30 to-transparent" />
                  <div className="relative flex h-full min-h-[16rem] flex-col justify-end p-6">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-background/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
                      <Smartphone className="h-3 w-3" /> Mobile
                    </span>
                  </div>
                </Link>

                {/* Backend */}
                <Link
                  to="/features/$slug"
                  params={{ slug: "backend" }}
                  className="group relative overflow-hidden rounded-[2rem] border border-border bg-card"
                >
                  <img
                    src={backendImg}
                    alt="Backend architecture visualisation"
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-card/20 to-transparent" />
                  <div className="relative flex h-full min-h-[16rem] flex-col justify-end p-6">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground backdrop-blur">
                      <Layers className="h-3 w-3" /> Backends
                    </span>
                  </div>
                </Link>
              </div>

              {/* Second row — consistent full-bleed editorial cards */}
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                {[
                  { slug: "extensions", img: extensionImg, icon: Puzzle, label: "Chrome extensions", dark: true },
                  { slug: "preview", img: previewImg, icon: Eye, label: "Live preview", dark: false },
                  { slug: "ship", img: shipImg, icon: Rocket, label: "One-click ship", dark: true },
                ].map((f) => (
                  <Link
                    key={f.slug}
                    to="/features/$slug"
                    params={{ slug: f.slug }}
                    className={`group relative overflow-hidden rounded-[2rem] border border-border ${f.dark ? "bg-foreground text-background" : "bg-card"}`}
                  >
                    <img
                      src={f.img}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-700 group-hover:scale-105"
                    />
                    <div
                      className={`absolute inset-0 bg-gradient-to-t ${f.dark ? "from-foreground/90 via-foreground/30" : "from-card/90 via-card/20"} to-transparent`}
                    />
                    <div className="relative flex h-full min-h-[16rem] flex-col justify-end p-6">
                      <span
                        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur ${f.dark ? "bg-background/15" : "bg-background/70 text-foreground"}`}
                      >
                        <f.icon className="h-3 w-3" /> {f.label}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <WholeStackSection />


          {/* Community showcase — replaces the old mobile hero (now lives on /features/mobile) */}
          <section id="community" className="relative overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
            <div
              className="pointer-events-none absolute right-[-6rem] top-1/3 -z-10 h-96 w-96 rounded-full bg-mint/40 blur-3xl animate-blob"
              aria-hidden
            />
            <div className="mx-auto max-w-6xl">
              <div className="grid gap-14 md:grid-cols-2 md:items-center">
                <div className="relative">
                  <div
                    className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-coral/25 via-butter/40 to-mint/30 blur-2xl"
                    aria-hidden
                  />
                  <img
                    src={webDashImg}
                    alt="Petal community projects preview"
                    loading="lazy"
                    className="w-full rounded-[2.5rem] object-cover shadow-[var(--shadow-editorial)]"
                  />
                  <div className="absolute -bottom-5 -right-4 rounded-2xl border border-border bg-background/95 px-4 py-3 shadow-[var(--shadow-soft)] backdrop-blur animate-float">
                    <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                      <Star className="h-3.5 w-3.5 fill-current" /> Lots of apps shipped
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Real projects, one prompt away.</p>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">Built with Petal</p>
                  <h2 className="mt-3 font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
                    A whole gallery of <span className="italic">shipped</span> apps.
                  </h2>
                  <p className="mt-5 text-lg text-muted-foreground">
                    Founders, designers, and solo builders open-source their Petal projects every day. Peek inside any
                    one, then remix it into your own with a click.
                  </p>
                  <ul className="mt-8 space-y-4 text-sm sm:text-base">
                    <li className="flex items-start gap-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-coral/25 text-foreground">
                        <Eye className="h-4 w-4" />
                      </span>
                      <span>
                        <strong className="font-semibold">Live previews</strong> — click any project to see the real,
                        running app.
                      </span>
                    </li>
                    <li className="flex items-start gap-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mint text-foreground">
                        <Copy className="h-4 w-4" />
                      </span>
                      <span>
                        <strong className="font-semibold">One-click remix</strong> — fork a shipped app into a fresh
                        copy on your account.
                      </span>
                    </li>
                    <li className="flex items-start gap-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-butter text-foreground">
                        <Rocket className="h-4 w-4" />
                      </span>
                      <span>
                        <strong className="font-semibold">Ship it further</strong> — publish under your own domain in a
                        click.
                      </span>
                    </li>
                  </ul>
                  <Link
                    to="/gallery"
                    className="mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition hover:-translate-y-0.5"
                  >
                    Explore the gallery <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* How it works — with founder portrait */}
          <section id="how" className="relative px-4 py-24 sm:px-6 sm:py-32">
            <div className="mx-auto max-w-6xl">
              <div className="grid gap-14 md:grid-cols-2 md:items-center">
                <div className="relative order-2 md:order-1">
                  <div
                    className="absolute -inset-4 -z-10 rounded-[3rem] bg-gradient-to-br from-primary/20 via-lilac/30 to-sky/30 blur-2xl"
                    aria-hidden
                  />
                  <img
                    src={founderImg}
                    alt="A founder building with Petal"
                    loading="lazy"
                    className="w-full rounded-[2rem] object-cover shadow-[var(--shadow-editorial)]"
                  />
                  <div className="absolute -bottom-6 -right-4 max-w-[220px] rounded-2xl border border-border bg-background/90 p-4 shadow-[var(--shadow-soft)] backdrop-blur animate-float">
                    <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                      <ShieldCheck className="h-3.5 w-3.5" /> Shipped in 12 min
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">"First real product I've ever launched."</p>
                  </div>
                </div>
                <div className="order-1 md:order-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">How it works</p>
                  <h2 className="mt-3 font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
                    Idea → live,
                    <br />
                    <span className="italic">in three steps.</span>
                  </h2>
                  <ol className="mt-10 space-y-8">
                    {[
                      {
                        n: "01",
                        t: "Describe it",
                        d: "One sentence in plain English — web, mobile, API or extension. No setup.",
                      },
                      {
                        n: "02",
                        t: "Watch it build",
                        d: "Petal researches, plans, writes the code, and streams a live preview while it works.",
                      },
                      {
                        n: "03",
                        t: "Ship it",
                        d: "Publish a URL, wire a custom domain, or download a signed mobile build.",
                      },
                    ].map((s) => (
                      <li key={s.n} className="group grid grid-cols-[auto_1fr] gap-6 border-t border-border pt-6">
                        <span className="font-display text-4xl font-black text-primary transition group-hover:translate-x-1">
                          {s.n}
                        </span>
                        <div>
                          <div className="font-display text-xl font-bold">{s.t}</div>
                          <p className="mt-1.5 text-sm text-muted-foreground">{s.d}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </section>

          {/* Marketplace band — the differentiator gets a full spread. */}
          <section id="marketplace" className="relative overflow-hidden border-y border-border bg-foreground text-background">
            <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-32">
              <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-end">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-coral">The marketplace</p>
                  <h2 className="mt-4 font-display text-[2.75rem] font-black leading-[0.9] tracking-[-0.045em] sm:text-6xl md:text-7xl">
                    Your build has
                    <br />
                    <span className="italic font-normal">a resale value.</span>
                  </h2>
                  <p className="mt-6 max-w-lg text-base leading-relaxed text-background/70 sm:text-lg">
                    Finish an app and it doesn't have to sit in your account. List it, price it, and hand it over to
                    someone who needs it — files, database schema and all. You keep 80%.
                  </p>
                  <div className="mt-10 flex flex-wrap gap-3">
                    <Link
                      to="/marketplace"
                      className="inline-flex items-center gap-2 rounded-full bg-background px-6 py-3.5 text-sm font-semibold text-foreground transition hover:-translate-y-0.5"
                    >
                      Browse listings <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      to="/sell"
                      className="inline-flex items-center gap-2 rounded-full border border-background/25 px-6 py-3.5 text-sm font-semibold text-background transition hover:border-background/60"
                    >
                      Sell a build
                    </Link>
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-8 border-t border-background/15 pt-10 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
                  {[
                    { stat: "80%", label: "Creator share on every sale" },
                    { stat: "$0", label: "Listing fee" },
                    { stat: "Full", label: "Project transfer, not a zip" },
                    { stat: "Live", label: "Working preview on each listing" },
                  ].map((s) => (
                    <div key={s.label}>
                      <dt className="font-display text-4xl font-black tracking-[-0.03em]">{s.stat}</dt>
                      <dd className="mt-2 text-xs leading-relaxed text-background/60">{s.label}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </section>

          {/* Pricing teaser — pay as you build, framed against subscriptions. */}
          <section id="pricing" className="px-5 py-24 sm:px-6 sm:py-32">
            <div className="mx-auto max-w-6xl">
              <div className="grid gap-12 md:grid-cols-[1fr_1.1fr] md:items-start">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-primary">Pay as you build</p>
                  <h2 className="mt-4 font-display text-[2.5rem] font-black leading-[0.9] tracking-[-0.045em] sm:text-5xl md:text-6xl">
                    Buy credits once.
                    <br />
                    <span className="italic font-normal">Use them whenever.</span>
                  </h2>
                  <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
                    A subscription is a bet that you'll build every month. Most people don't. Petal charges for the work
                    it does and leaves the rest of your balance alone.
                  </p>
                  <Link
                    to="/why/$slug"
                    params={{ slug: "pay-as-you-build" }}
                    className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    How billing works <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                <ul className="space-y-px">
                  {[
                    {
                      t: "Credits never expire",
                      d: "Buy a pack, come back in six months, it's still there. No monthly reset, no clawback.",
                    },
                    {
                      t: "No-op turns are free",
                      d: "If a build produces byte-identical files, nothing is charged. You pay for changes, not for asking.",
                    },
                    {
                      t: "Subscriptions stay optional",
                      d: "Plans exist for people who want a monthly allowance. Nothing about the builder is locked behind one.",
                    },
                    {
                      t: "The meter is published",
                      d: "Backend hours, images and model spend each have a stated rate you can read before you spend.",
                    },
                  ].map((row) => (
                    <li key={row.t} className="border-t border-border py-6">
                      <div className="font-display text-xl font-bold tracking-[-0.02em]">{row.t}</div>
                      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{row.d}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* FAQ — plain answers, no accordion theatre. */}
          <section id="faq" className="px-5 pb-24 sm:px-6 sm:pb-32">
            <div className="mx-auto max-w-6xl">
              <h2 className="max-w-2xl font-display text-[2.25rem] font-black leading-[0.92] tracking-[-0.04em] sm:text-5xl">
                Questions people <span className="italic font-normal">actually ask.</span>
              </h2>
              <div className="mt-12 grid gap-x-14 gap-y-px md:grid-cols-2">
                {[
                  {
                    q: "Do I need a subscription?",
                    a: "No. Buy a credit pack and build. Plans exist if you want a monthly allowance, but the builder, the marketplace and publishing all work without one.",
                  },
                  {
                    q: "What happens to unused credits?",
                    a: "Nothing. They stay in your balance indefinitely. There is no expiry date and no monthly reset.",
                  },
                  {
                    q: "Can I really sell an app I built here?",
                    a: "Yes. Publish it as a marketplace listing, set a price, and Petal handles checkout and transferring the project to the buyer. You keep 80% of every sale.",
                  },
                  {
                    q: "Is it real code or a locked-in builder?",
                    a: "Real React and TypeScript in a real file tree. Sync it to your own Git repository, edit it locally, and deploy it wherever you like.",
                  },
                  {
                    q: "What if the build breaks?",
                    a: "Petal verifies each build in a browser before calling it done, routes any defects to the specialist that owns them, and repairs in a scoped round rather than rewriting your app.",
                  },
                  {
                    q: "Can it build mobile apps?",
                    a: "Yes — one mobile target that ships to both stores. Preview it on your phone by scanning a QR code while it builds.",
                  },
                ].map((f) => (
                  <div key={f.q} className="border-t border-border py-7">
                    <h3 className="font-display text-lg font-bold tracking-[-0.015em]">{f.q}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>


          {/* Final CTA */}
          <section className="px-4 pb-20 sm:px-6 sm:pb-28">
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] border border-border bg-foreground p-10 text-background shadow-[var(--shadow-editorial)] sm:p-16 md:p-20">
              <div
                className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-coral/60 blur-3xl animate-blob"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-mint/40 blur-3xl animate-blob"
                aria-hidden
              />
              <div className="relative text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-background/60">Your turn</p>
                <h2 className="mx-auto mt-4 max-w-3xl font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
                  Your next app is <span className="italic text-coral">one sentence</span> away.
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-base text-background/70 sm:text-lg">
                  Web, mobile, backend or extension — describe it, Petal ships it.
                </p>
                {showAuthedHero ? (
                  <Link
                    to="/projects"
                    className="mt-10 inline-flex h-14 items-center gap-2 rounded-full bg-background px-8 text-base font-semibold text-foreground transition hover:scale-[1.02] hover:brightness-105"
                  >
                    Open my projects
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    to="/auth"
                    search={{ mode: "signup", redirect: undefined }}
                    className="mt-10 inline-flex h-14 items-center gap-2 rounded-full bg-background px-8 text-base font-semibold text-foreground transition hover:scale-[1.02] hover:brightness-105"
                  >
                    Start building free
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <p className="mt-4 text-xs text-background/50">No credit card · Live preview</p>
              </div>
            </div>
          </section>

          <footer className="border-t border-border bg-card/40">
            <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted-foreground sm:px-6 md:flex-row">
              <div className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-foreground">
                Petal <span className="text-muted-foreground font-normal italic">— build real software with AI.</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-5">
                <Link to="/why/$slug" params={{ slug: "marketplace" }} className="hover:text-foreground">
                  Marketplace
                </Link>
                <Link to="/why/$slug" params={{ slug: "pay-as-you-build" }} className="hover:text-foreground">
                  Pricing model
                </Link>
                <Link to="/why/$slug" params={{ slug: "agent-board" }} className="hover:text-foreground">
                  Agent board
                </Link>
                <Link to="/why/$slug" params={{ slug: "own-your-code" }} className="hover:text-foreground">
                  Own your code
                </Link>
                <Link to="/coffee" className="hover:text-foreground">
                  Buy us coffee
                </Link>
                <Link to="/invest" className="hover:text-foreground">
                  Invest
                </Link>
                <Link to="/changelog" className="hover:text-foreground">
                  What's new
                </Link>
                <Link to="/privacy" className="hover:text-foreground">
                  Privacy
                </Link>
                <Link to="/terms" className="hover:text-foreground">
                  Terms
                </Link>
                <span>© {new Date().getFullYear()} Petal, A Kesh Technologies Limited Company</span>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
