import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/lib/auth";
import { clearLastAuthEmail, readLastAuthEmail, writeLastAuthEmail } from "@/lib/draft-storage";
import { toast } from "sonner";
import { WaitlistPanel } from "@/components/WaitlistPanel";

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
      { title: "Sign in · Petal" },
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
  const { user, loading } = useAuth();
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

  if (loading || user) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
        <div className="absolute inset-0 bg-grain opacity-40" aria-hidden />
      </div>
    );
  }

  const title =
    mode === "signup" ? "Create your account" :
    mode === "forgot" ? "Reset your password" :
    "Welcome back";
  const subtitle =
    mode === "signup" ? "Save your projects and pick up right where you left off." :
    mode === "forgot" ? "We'll email you a secure link to set a new password." :
    "Sign in to continue building.";
  const submitLabel =
    mode === "signup" ? "Create account" :
    mode === "forgot" ? "Send reset link" :
    "Sign in";

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
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        {/* Editorial left panel */}
        <aside className="relative hidden overflow-hidden lg:block">
          <div className="absolute inset-0 bg-aurora opacity-90" aria-hidden />
          <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
          <img
            src="https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=1200&q=80&auto=format&fit=crop"
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-multiply"
            loading="lazy"
          />
          <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
            <Link to="/" className="inline-flex items-center gap-2.5 group">
              <img
                src="/petal-logo.png"
                alt=""
                aria-hidden
                className="h-10 w-10 object-contain transition-transform group-hover:-rotate-6"
              />
              <span className="font-display text-3xl font-black tracking-[-0.035em] text-foreground">
                Petal
              </span>
            </Link>

            <div className="max-w-lg">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-foreground/70">
                Build with a sentence
              </p>
              <h2 className="heading-editorial mt-5 text-5xl xl:text-6xl">
                From a whisper of an idea to <em>a shipped app</em> — in one chat.
              </h2>
              <p className="mt-6 max-w-md text-base leading-relaxed text-foreground/75">
                Web, mobile, backends, extensions. Petal listens, plans, builds, and
                deploys — while you watch it happen.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <p className="font-display text-3xl font-black tracking-tight text-foreground">18k+</p>
                <p className="mt-1 text-xs text-muted-foreground">Apps built</p>
              </div>
              <div>
                <p className="font-display text-3xl font-black tracking-tight text-foreground">4</p>
                <p className="mt-1 text-xs text-muted-foreground">Targets in one chat</p>
              </div>
              <div>
                <p className="font-display text-3xl font-black tracking-tight text-foreground">$5</p>
                <p className="mt-1 text-xs text-muted-foreground">Free credit to start</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Auth card side */}
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12 sm:px-8">
          <div className="pointer-events-none absolute inset-0 bg-aurora opacity-60 lg:hidden" aria-hidden />
          <div className="pointer-events-none absolute inset-0 bg-grain opacity-30 lg:hidden" aria-hidden />

          <div className="relative w-full max-w-md">
            <Link
              to="/"
              className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground lg:hidden"
            >
              <img src="/petal-logo.png" alt="" aria-hidden className="h-8 w-8 object-contain" />
              <span className="font-display text-2xl font-black tracking-[-0.03em] text-foreground">
                Petal
              </span>
            </Link>

            <div className="rounded-[2rem] border border-border bg-card/95 p-8 shadow-[var(--shadow-editorial)] backdrop-blur sm:p-10">
              {mode === "forgot" && (
                <button
                  onClick={() => switchMode("signin")}
                  className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to sign in
                </button>
              )}

              <h1 className="heading-editorial text-4xl sm:text-[2.75rem]">{title}</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>

              {duplicateEmail && (
                <div className="mt-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
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
                      className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-105"
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-medium hover:bg-muted"
                    >
                      Reset password
                    </button>
                  </div>
                </div>
              )}

              {resetSent && (
                <div className="mt-5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
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

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Email
                  </span>
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3.5 transition focus-within:border-primary focus-within:shadow-[0_0_0_4px_oklch(0.78_0.13_25/0.12)]">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setDuplicateEmail(null); }}
                      className="h-12 flex-1 bg-transparent text-sm outline-none"
                      placeholder="you@example.com"
                    />
                  </div>
                </label>

                {mode !== "forgot" && (
                  <label className="block">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Password
                      </span>
                      {mode === "signin" && (
                        <button
                          type="button"
                          onClick={() => switchMode("forgot")}
                          className="text-xs font-medium text-foreground hover:underline"
                        >
                          Forgot?
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3.5 transition focus-within:border-primary focus-within:shadow-[0_0_0_4px_oklch(0.78_0.13_25/0.12)]">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <input
                        type={showPw ? "text" : "password"}
                        required
                        minLength={mode === "signup" ? 8 : 6}
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-12 flex-1 bg-transparent text-sm outline-none"
                        placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((v) => !v)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {mode === "signup" && <StrengthMeter password={password} />}
                  </label>
                )}

                <button
                  type="submit"
                  disabled={busy || (mode === "signup" && scorePassword(password).score < 1)}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-sm font-semibold text-background shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-editorial)] disabled:opacity-50 disabled:hover:translate-y-0"
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
                    New to Petal?{" "}
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
      </div>
    </div>
  );
}


