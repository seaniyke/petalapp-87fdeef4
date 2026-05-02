import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react";
import petalLogo from "@/assets/petal-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";
import { clearLastAuthEmail, readLastAuthEmail, writeLastAuthEmail } from "@/lib/draft-storage";
import { toast } from "sonner";

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

  async function handleGoogle() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: postAuthUrl,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Could not sign in with Google");
        setBusy(false);
        return;
      }
      if (result.redirected) return;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign in with Google");
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
      <div className="absolute inset-0 bg-grain opacity-40" aria-hidden />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <img src={petalLogo} alt="Petal" className="h-8 w-8 object-contain" />
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">Petal</span>
        </Link>

        <div className="rounded-3xl border border-border bg-card/95 p-8 shadow-[var(--shadow-soft)] backdrop-blur">
          {mode === "forgot" && (
            <button
              onClick={() => switchMode("signin")}
              className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </button>
          )}

          <h1 className="font-display text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

          {/* Duplicate email banner */}
          {duplicateEmail && (
            <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium text-foreground">
                An account with <span className="font-mono">{duplicateEmail}</span> already exists.
              </p>
              <p className="mt-1 text-muted-foreground">
                Try signing in instead, or reset the password if you've forgotten it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { switchMode("signin"); }}
                  className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-105"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => { switchMode("forgot"); }}
                  className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
                >
                  Reset password
                </button>
              </div>
            </div>
          )}

          {/* Reset-link sent confirmation */}
          {resetSent && (
            <div className="mt-5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                <div>
                  <p className="font-medium text-foreground">Check your inbox</p>
                  <p className="mt-1 text-muted-foreground">
                    If an account exists for <span className="font-mono">{resetSent}</span>, a reset
                    link is on its way. The link expires in 1 hour.
                  </p>
                </div>
              </div>
            </div>
          )}

          {mode !== "forgot" && (
            <>
              <button
                onClick={handleGoogle}
                disabled={busy}
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-medium transition hover:bg-muted disabled:opacity-50"
              >
                <GoogleIcon /> Continue with Google
              </button>

              <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Email</span>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
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
              <label className="block">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Password</span>
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
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <input
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
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
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
                <button onClick={() => switchMode("signin")} className="font-medium text-foreground underline-offset-2 hover:underline">
                  Sign in
                </button>
              </>
            ) : mode === "signin" ? (
              <>
                New to Petal?{" "}
                <button onClick={() => switchMode("signup")} className="font-medium text-foreground underline-offset-2 hover:underline">
                  Create an account
                </button>
              </>
            ) : (
              <>
                Remembered it?{" "}
                <button onClick={() => switchMode("signin")} className="font-medium text-foreground underline-offset-2 hover:underline">
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

