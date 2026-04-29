import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import petalLogo from "@/assets/petal-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password · Petal" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

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

function ResetPasswordPage() {
  const navigate = useNavigate();
  // Track recovery-session readiness so we don't show the form to a casual visitor.
  const [phase, setPhase] = useState<"checking" | "ready" | "no-session" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the user lands via the email link.
    // We also accept an existing session as valid (some flows auto-establish it).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setPhase("ready");
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setPhase((p) => (p === "checking" ? (data.session ? "ready" : "no-session") : p));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    if (strength.score < 1) {
      toast.error("Please pick a stronger password (8+ characters).");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPhase("done");
      toast.success("Password updated.");
      setTimeout(() => navigate({ to: "/" }), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update password");
    } finally {
      setBusy(false);
    }
  }

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
          {phase === "checking" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying your reset link…
            </div>
          )}

          {phase === "no-session" && (
            <>
              <h1 className="font-display text-2xl">This reset link is no longer valid</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Reset links expire after 1 hour and can only be used once. Request a new one to continue.
              </p>
              <Link
                to="/auth"
                search={{ mode: "forgot" }}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground hover:brightness-105"
              >
                Request a new link
              </Link>
            </>
          )}

          {phase === "done" && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-1 h-5 w-5 text-emerald-600" />
              <div>
                <h1 className="font-display text-2xl">Password updated</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  You're signed in. Taking you home…
                </p>
              </div>
            </div>
          )}

          {phase === "ready" && (
            <>
              <h1 className="font-display text-3xl">Set a new password</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Choose something strong — at least 8 characters, with a mix of letters, numbers, and symbols.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">New password</span>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <input
                      type={show ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 flex-1 bg-transparent text-sm outline-none"
                      placeholder="At least 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={show ? "Hide password" : "Show password"}
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {password && (
                    <div className="mt-2">
                      <div className="flex gap-1">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                              i < strength.score
                                ? strength.score >= 3
                                  ? "bg-emerald-500"
                                  : strength.score === 2
                                    ? "bg-amber-500"
                                    : "bg-destructive"
                                : "bg-muted"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{strength.label}</p>
                    </div>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Confirm password</span>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <input
                      type={show ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="h-11 flex-1 bg-transparent text-sm outline-none"
                      placeholder="Repeat new password"
                    />
                  </div>
                  {confirm && confirm !== password && (
                    <p className="mt-1 text-xs text-destructive">Passwords don't match.</p>
                  )}
                </label>

                <button
                  type="submit"
                  disabled={busy || strength.score < 1 || password !== confirm}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Update password
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
