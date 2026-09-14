import { useEffect, useState } from "react";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const CONSENT_KEY = "petal:consent:v1";

type ConsentChoice = "accepted" | "declined";

// Re-applies the stored (or newly made) choice through Google's Consent Mode.
// The gtag config in the root route sets every signal to "denied" by default,
// so nothing is tracked until this runs with "accepted".
function applyConsent(choice: ConsentChoice) {
  const granted = choice === "accepted" ? "granted" : "denied";
  window.gtag?.("consent", "update", {
    ad_storage: granted,
    ad_user_data: granted,
    ad_personalization: granted,
    analytics_storage: granted,
  });
}

function readStoredChoice(): ConsentChoice | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  // Client-only: localStorage isn't readable during SSR. A stored choice is
  // re-applied silently on every page so Consent Mode carries across visits.
  useEffect(() => {
    const stored = readStoredChoice();
    if (stored) {
      applyConsent(stored);
    } else {
      setVisible(true);
    }
  }, []);

  const choose = (choice: ConsentChoice) => {
    try {
      window.localStorage.setItem(CONSENT_KEY, choice);
    } catch {
      // Storage unavailable — still apply for this session.
    }
    applyConsent(choice);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[80] p-4"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg sm:flex-row sm:items-center">
        <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
          Petal uses cookies to understand how the site is used and to improve
          it. Accept to allow analytics and ads measurement, or decline to keep
          tracking off.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose("declined")}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
