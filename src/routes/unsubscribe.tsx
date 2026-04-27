import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type Phase = "loading" | "ready" | "already" | "invalid" | "submitting" | "done" | "error";

export const Route = createFileRoute("/unsubscribe")({
  component: UnsubscribePage,
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
});

function UnsubscribePage() {
  const { token } = useSearch({ from: "/unsubscribe" });
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPhase("invalid");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPhase("invalid");
          setErrMsg(data?.error ?? "Invalid or expired link.");
          return;
        }
        if (data?.alreadyUnsubscribed || data?.used) {
          setPhase("already");
          setEmail(data?.email ?? null);
          return;
        }
        setEmail(data?.email ?? null);
        setPhase("ready");
      } catch {
        setPhase("invalid");
      }
    })();
  }, [token]);

  async function handleConfirm() {
    setPhase("submitting");
    try {
      const res = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrMsg(data?.error ?? "Could not unsubscribe. Try again.");
        setPhase("error");
        return;
      }
      setPhase("done");
    } catch {
      setErrMsg("Network error. Try again.");
      setPhase("error");
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Email preferences</h1>

        {phase === "loading" && (
          <p className="mt-4 text-sm text-muted-foreground">Checking your link…</p>
        )}

        {phase === "ready" && (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              {email ? <>Unsubscribe <strong>{email}</strong> from Petal app emails?</> : "Unsubscribe from Petal app emails?"}
              {" "}You'll still receive essential account notifications.
            </p>
            <button
              onClick={handleConfirm}
              className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Confirm unsubscribe
            </button>
          </>
        )}

        {phase === "submitting" && (
          <p className="mt-4 text-sm text-muted-foreground">Updating your preferences…</p>
        )}

        {phase === "done" && (
          <p className="mt-4 text-sm text-foreground">
            You've been unsubscribed{email ? <> — <strong>{email}</strong></> : ""}. Sorry to see you go.
          </p>
        )}

        {phase === "already" && (
          <p className="mt-4 text-sm text-foreground">
            {email ? <><strong>{email}</strong> is already unsubscribed.</> : "This address is already unsubscribed."}
          </p>
        )}

        {phase === "invalid" && (
          <p className="mt-4 text-sm text-destructive">
            {errMsg ?? "This unsubscribe link is invalid or expired."}
          </p>
        )}

        {phase === "error" && (
          <>
            <p className="mt-4 text-sm text-destructive">{errMsg}</p>
            <button
              onClick={handleConfirm}
              className="mt-4 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
