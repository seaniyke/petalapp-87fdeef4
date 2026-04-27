import { useEffect, useState } from "react";
import { X, MessageSquare, Eye, Rocket } from "lucide-react";

/**
 * 3-step product tour shown the first time a user lands on /builder.
 *
 * Persistence: a tiny localStorage flag (`petal:first-run-tour:v1`) records
 * completion. We use a versioned key so we can re-show the tour to existing
 * users in the future if we materially change the product.
 *
 * Anchoring: instead of trying to absolutely-position tooltips against
 * specific DOM nodes (fragile across responsive layouts), we render a
 * centered card with arrow-text that POINTS at the relevant area
 * ("← The chat lives on the left", "↑ Your app preview", etc.). This works
 * on every viewport and survives any builder layout change.
 */

const STORAGE_KEY = "petal:first-run-tour:v1";

type Step = {
  Icon: typeof MessageSquare;
  badge: string;
  title: string;
  body: string;
  pointer: string;
};

const STEPS: Step[] = [
  {
    Icon: MessageSquare,
    badge: "1 of 3",
    title: "Chat is your remote control",
    body: "Tell Petal what to build, or what to change. Plain language is enough — no commands, no syntax. The composer lives on the left.",
    pointer: "← The chat panel",
  },
  {
    Icon: Eye,
    badge: "2 of 3",
    title: "Watch your app come to life",
    body: "Every change runs in a real preview on the right. Toggle to Code view if you want to see the files Petal wrote.",
    pointer: "↑ Live preview",
  },
  {
    Icon: Rocket,
    badge: "3 of 3",
    title: "Publish when you're ready",
    body: "Hit Publish in the top bar to get a shareable URL. You can keep iterating after — every publish is a new version.",
    pointer: "↗ Publish in the header",
  },
];

export function FirstRunTour() {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  // Decide on mount whether to show. We delay one tick so the builder has a
  // chance to paint first — otherwise the tour pops up on top of a blank
  // skeleton, which feels jarring.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      // Some browsers (private mode, embedded webviews) throw on access.
      // Silently treat as "already seen" rather than nagging the user.
      return;
    }
    const t = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(t);
  }, []);

  const close = (markComplete: boolean) => {
    setOpen(false);
    if (markComplete) {
      try {
        window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
    }
  };

  if (!open) return null;
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="false"
      aria-labelledby="first-run-tour-title"
    >
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-border bg-card/95 p-5 shadow-[var(--shadow-glow)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
              <current.Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {current.badge}
              </p>
              <h2 id="first-run-tour-title" className="font-display text-base leading-tight">
                {current.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => close(true)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Skip tour"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{current.body}</p>
        <p className="mt-2 text-[11px] font-medium text-primary/90">{current.pointer}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition ${
                  i === step ? "w-4 bg-primary" : "bg-border"
                }`}
                aria-hidden
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => close(true)}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => (isLast ? close(true) : setStep((s) => s + 1))}
              className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition hover:brightness-105"
            >
              {isLast ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
