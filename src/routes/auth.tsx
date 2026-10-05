import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, Github } from "lucide-react";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z"
      />
    </svg>
  );
}

import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/lib/auth";
import { clearLastAuthEmail, readLastAuthEmail, writeLastAuthEmail } from "@/lib/draft-storage";
import { toast } from "@/lib/notify";
import { WaitlistPanel } from "@/components/WaitlistPanel";
import { SiteHeader } from "@/components/SiteHeader";

/**
 * Only allow internal, same-origin redirect targets. Rejects:
 *   - absolute URLs (https://evil.com/x)
 *   - protocol-relative URLs (//evil.com/x, /\evil.com/x)
 *   - anything that isn't a path starting with "/"
 * Returns a safe path or `undefined`.
 */
function sanitizeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;
  return raw;
}

type Mode = "signin" | "signup" | "forgot";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => {
    const m = search.mode;
    const mode: Mode =
      m === "signup" ? "signup" : m === "forgot" ? "forgot" : "signin";
    return { mode, redirect: sanitizeRedirect(search.redirect) };
  },
  head: () => ({
    meta: [
      { title: "Sign in · Kimble" },
      { name: "description", content: "Sign in to keep your projects across sessions." },
    ],
  }),
  component: AuthPage,
});

/* -------------------------- Password strength meter ------------------------ */

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  const label = ["Too short", "Weak", "Okay", "Strong", "Excellent"][Math.min(s, 4)];
  return { score: Math.min(s, 4) as 0 | 1 | 2 | 3 | 4, label };
}

function StrengthMeter({ password }: { password: string }) {
  const { score, label } = useMemo(() => scorePassword(password), [password]);
  if (!password) return null;
  const colors = ["bg-destructive", "bg-destructive", "bg-amber-500", "bg-emerald-500", "bg-emerald-500"];
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < score ? colors[score] : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/* --------------------------------- Page ---------------------------------- */

function AuthPage() {
  const { mode: initialMode, redirect } = Route.useSearch();
  const { user, loading, likelyAuthed } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(() => readLastAuthEmail());
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set when signup detects an existing email — prompts user to sign in or reset.
  const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
  // Shown after a successful password-reset request so the user knows what to do.
  const [resetSent, setResetSent] = useState<string | null>(null);
  // Waitlist gate: null = still checking, true = show waitlist instead of auth.
  const [waitlist, setWaitlist] = useState<boolean | null>(null);
  const [bypassWaitlist, setBypassWaitlist] = useState(false);
  const [lastMethod] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.localStorage.getItem("kimble-last-auth-method"),
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/waitlist")
      .then((r) => r.json())
      .then((j: { enabled?: boolean }) => {
        if (!cancelled) setWaitlist(Boolean(j?.enabled));
      })
      .catch(() => {
        if (!cancelled) setWaitlist(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeLastAuthEmail(email);
  }, [email]);


  const postAuthPath = redirect ?? "/";
  const postAuthUrl =
    typeof window === "undefined" ? postAuthPath : window.location.origin + postAuthPath;
  const resetRedirectUrl =
    typeof window === "undefined" ? "/reset-password" : window.location.origin + "/reset-password";

  useEffect(() => {
    if (!loading && user) {
      window.location.assign(redirect ?? "/");
    }
  }, [loading, user, redirect]);

  function switchMode(next: Mode) {
    setMode(next);
    setDuplicateEmail(null);
    setResetSent(null);
  }

  async function handleSignUp() {
    // Detect existing-email signup: Supabase returns success with empty
    // identities[] (to prevent enumeration). We treat that as "already taken".
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: postAuthUrl },
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        setDuplicateEmail(email);
        return;
      }
      throw error;
    }
    const identities = data.user?.identities ?? [];
    if (data.user && identities.length === 0) {
      // Email is already registered — Supabase silently no-ops.
      setDuplicateEmail(email);
      return;
    }
    toast.success("Check your email to confirm your account.");
    clearLastAuthEmail();
  }

  async function handleSignIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid") || msg.includes("credentials")) {
        throw new Error("That email and password don't match. Try again or reset your password.");
      }
      if (msg.includes("not confirmed") || msg.includes("confirm")) {
        throw new Error("Please confirm your email first — check your inbox.");
      }
      throw error;
    }
    toast.success("Welcome back!");
    clearLastAuthEmail();
  }

  async function handleForgot() {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectUrl,
    });
    if (error) throw error;
    setResetSent(email);
  }

  async function handleOAuth(provider: "google" | "github") {
    setBusy(true);
    try {
      window.localStorage.setItem("kimble-last-auth-method", provider);
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: postAuthUrl },
      });
      if (error) throw error;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDuplicateEmail(null);
    try {
      if (mode === "signup") await handleSignUp();
      else if (mode === "forgot") await handleForgot();
      else await handleSignIn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // The sign-in form is public, so there is nothing to wait for unless this
  // visitor might already be signed in (a token sits in storage) — in which
  // case we're about to redirect them and a flash of the form would be wrong.
  // Everyone else, including the server render and every first-time visitor,
  // gets the form on the first frame instead of an empty gradient.
  if (user || (loading && likelyAuthed)) {
    return (
      <div className="landing-page min-h-screen bg-background" />
    );
  }

  const title =
    mode === "signup" ? "Create your account" :
    mode === "forgot" ? "Reset your password" :
    "Log in";
  const submitLabel =
    mode === "signup" ? "Continue" :
    mode === "forgot" ? "Send reset link" :
    "Continue";

  // Sign-in and password reset are always open — existing accounts must be
  // able to get back in. Only *new* accounts sit behind the waitlist.
  if (waitlist === null && !user && mode === "signup") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (mode === "signup" && waitlist && !bypassWaitlist && !user) {
    return (
      <WaitlistPanel
        onHaveAccess={() => setBypassWaitlist(true)}
        onSignIn={() => switchMode("signin")}
      />
    );
  }


  return (
    <div className="landing-page relative min-h-screen overflow-hidden bg-background text-foreground">
      <SiteHeader />
      <div className="pointer-events-none absolute inset-0 bg-[image:var(--gradient-aura)] opacity-90" aria-hidden />
      <div className="relative mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col justify-center px-6 pb-16 pt-10 sm:px-8">
            <img src="/kimble-logo.png" alt="Kimble" className="h-12 w-12 dark:invert" />
            <h1 className="mt-7 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">{title}</h1>

            {mode !== "forgot" && (
              <>
                <div className="mt-9 space-y-3">
                  <div className="relative">
                    {lastMethod === "google" && (
                      <span className="absolute -top-2.5 right-4 z-10 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                        Last used
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleOAuth("google")}
                      className={`inline-flex h-12 w-full items-center justify-center gap-3 rounded-md border bg-card/60 text-[15px] font-medium backdrop-blur transition hover:bg-card disabled:opacity-50 ${
                        lastMethod === "google" ? "border-primary/60" : "border-border/70"
                      }`}
                    >
                      <GoogleIcon className="h-5 w-5" />
                      Continue with Google
                    </button>
                  </div>
                  <div className="relative">
                    {lastMethod === "github" && (
                      <span className="absolute -top-2.5 right-4 z-10 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                        Last used
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleOAuth("github")}
                      className={`inline-flex h-12 w-full items-center justify-center gap-3 rounded-md border bg-card/60 text-[15px] font-medium backdrop-blur transition hover:bg-card disabled:opacity-50 ${
                        lastMethod === "github" ? "border-primary/60" : "border-border/70"
                      }`}
                    >
                      <Github className="h-5 w-5" />
                      Continue with GitHub
                    </button>
                  </div>
                </div>

                <div className="my-7 flex items-center gap-4" aria-hidden>
                  <div className="h-px flex-1 bg-border/70" />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">OR</span>
                  <div className="h-px flex-1 bg-border/70" />
                </div>
              </>
            )}

            <div>
              {mode === "forgot" && (
                <button
                  onClick={() => switchMode("signin")}
                  className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </button>
              )}


              {duplicateEmail && (
                <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                  <p className="font-medium text-foreground">
                    An account with <span className="font-mono">{duplicateEmail}</span> already exists.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Try signing in, or reset the password if you've forgotten it.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => switchMode("signin")}
                      className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-105"
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="inline-flex h-7 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                    >
                      Reset password
                    </button>
                  </div>
                </div>
              )}

              {resetSent && (
                <div className="mt-5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    <div>
                      <p className="font-medium text-foreground">Check your inbox</p>
                      <p className="mt-1 text-muted-foreground">
                        If an account exists for <span className="font-mono">{resetSent}</span>, a
                        reset link is on its way. The link expires in 1 hour.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-1 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Email
                  </span>
                  <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3.5 transition focus-within:border-primary/50">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setDuplicateEmail(null); }}
                      className="h-11 flex-1 bg-transparent text-sm outline-none"
                      placeholder="you@example.com"
                    />
                  </div>
                </label>

                {mode !== "forgot" && (
                  <div className="block">
                    <div className="mb-1.5 flex items-center justify-between">
                      <label
                        htmlFor="petal-password"
                        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        Password
                      </label>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3.5 transition focus-within:border-primary/50">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <input
                        id="petal-password"
                        type={showPw ? "text" : "password"}
                        required
                        minLength={mode === "signup" ? 8 : 6}
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 flex-1 bg-transparent text-sm outline-none"
                        placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="-mr-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {mode === "signup" && <StrengthMeter password={password} />}
                    {mode === "signin" && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                        >
                          Forgot password?
                        </button>
                      </div>
                    )}
                  </div>
                )}


                <button
                  type="submit"
                  disabled={busy || (mode === "signup" && scorePassword(password).score < 1)}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitLabel}
                </button>
              </form>

              {mode === "signup" && (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  By creating an account you agree to our terms and privacy policy.
                </p>
              )}

              <div className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "signup" ? (
                  <>
                    Already have an account?{" "}
                    <button onClick={() => switchMode("signin")} className="font-semibold text-foreground underline-offset-2 hover:underline">
                      Sign in
                    </button>
                  </>
                ) : mode === "signin" ? (
                  <>
                    New to Kimble?{" "}
                    <button onClick={() => switchMode("signup")} className="font-semibold text-foreground underline-offset-2 hover:underline">
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Remembered it?{" "}
                    <button onClick={() => switchMode("signin")} className="font-semibold text-foreground underline-offset-2 hover:underline">
                      Sign in
                    </button>
                  </>
                )}
              </div>
            </div>
      </div>
    </div>
  );
}


