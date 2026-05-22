import { Sparkles } from "lucide-react";

import { START_IDEAS, type StartIdea } from "@/lib/start-ideas";

/**
 * Curated starter prompts surfaced under the landing-page composer.
 *
 * Why this exists: the empty textarea is the highest-friction moment for a
 * first-time visitor — they don't know what to type, what's possible, or
 * what "good" looks like. Showing 6–8 hand-written, concrete ideas (with a
 * 1-line description and a category icon) reframes the page from "type
 * something" to "pick something". Clicking a card pre-fills the composer and
 * focuses it so the user can either submit as-is or tweak the wording.
 *
 * The prompts are intentionally specific (mention features) rather than
 * generic ("a todo app") — vague prompts produce vague apps.
 */

// Curated landing-page subset: featured ideas first, then top up to 12 with a
// spread across categories so the rail feels diverse on first glance.
function pickLandingIdeas(): StartIdea[] {
  const featured = START_IDEAS.filter((i) => i.featured);
  const seenCats = new Set(featured.map((i) => i.category));
  const extras: StartIdea[] = [];
  for (const idea of START_IDEAS) {
    if (extras.length + featured.length >= 12) break;
    if (idea.featured) continue;
    if (seenCats.has(idea.category)) continue;
    extras.push(idea);
    seenCats.add(idea.category);
  }
  return [...featured, ...extras].slice(0, 12);
}

const LANDING_IDEAS = pickLandingIdeas();

const ACCENT_BG: Record<StartIdea["accent"], string> = {
  pink: "bg-primary/10 text-primary",
  mint: "bg-mint/30 text-foreground/80",
  lilac: "bg-lilac/30 text-foreground/80",
  sky: "bg-sky/30 text-foreground/80",
  butter: "bg-butter/40 text-foreground/80",
};

export function StartIdeasPanel({
  onPick,
  onSwitchToCoach,
}: {
  onPick: (prompt: string) => void;
  onSwitchToCoach?: () => void;
}) {
  return (
    <section aria-labelledby="start-ideas-heading" className="mx-auto mt-8 max-w-4xl md:px-0">
      <div className="mb-3 flex items-center justify-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <h2
          id="start-ideas-heading"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Need a spark? Try one of these
        </h2>
      </div>
      {/* Mobile/tablet: horizontal swipeable rail with scroll-snap.
          Desktop (md+): falls back to a tidy 4-col grid. */}
      <ul
        className="
          flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2
          [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
          [scroll-padding-left:1rem] [scroll-padding-right:1rem]
          md:grid md:grid-cols-4 md:gap-2 md:overflow-visible md:px-0 md:pb-0
        "
      >
        {LANDING_IDEAS.map((idea) => (
          <li
            key={idea.title}
            className="snap-start shrink-0 basis-[62%] sm:basis-[42%] md:basis-auto"
          >
            <button
              type="button"
              onClick={() => onPick(idea.prompt)}
              className="group flex h-full w-full flex-col items-start gap-1.5 rounded-2xl border border-border bg-card/80 p-3 text-left transition hover:border-primary/40 hover:bg-card hover:shadow-[var(--shadow-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span
                className={`grid h-7 w-7 place-items-center rounded-lg ${ACCENT_BG[idea.accent]}`}
              >
                <idea.Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-medium leading-tight text-foreground">
                {idea.title}
              </span>
              <span className="line-clamp-2 text-[10.5px] leading-snug text-muted-foreground">
                {idea.prompt}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {onSwitchToCoach && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={onSwitchToCoach}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Sparkles className="h-3 w-3 text-lilac" />
            Not seeing what you want? Help me think →
          </button>
        </div>
      )}
    </section>
  );
}
