import { Compass } from "lucide-react";

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
    if (extras.length + featured.length >= 4) break;
    if (idea.featured) continue;
    if (seenCats.has(idea.category)) continue;
    extras.push(idea);
    seenCats.add(idea.category);
  }
  return [...featured, ...extras].slice(0, 4);
}


const LANDING_IDEAS = pickLandingIdeas();

export function StartIdeasPanel({
  onPick,
  onSwitchToCoach,
}: {
  onPick: (prompt: string) => void;
  onSwitchToCoach?: () => void;
}) {
  return (
    <section aria-labelledby="start-ideas-heading" className="mx-auto mt-5 max-w-3xl">
      <h2 id="start-ideas-heading" className="sr-only">Starter ideas</h2>
      <ul
        className="flex snap-x gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:justify-center sm:overflow-visible"
      >
        {LANDING_IDEAS.map((idea) => (
          <li key={idea.title} className="snap-start shrink-0">
            <button
              type="button"
              onClick={() => onPick(idea.prompt)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-xs font-medium text-muted-foreground transition hover:border-foreground/25 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <idea.Icon className="h-3.5 w-3.5" />
              {idea.title}
            </button>
          </li>
        ))}
      </ul>
      {onSwitchToCoach && (
        <div className="mt-1 text-center">
          <button
            type="button"
            onClick={onSwitchToCoach}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Compass className="h-3.5 w-3.5" />
            Help me shape an idea
          </button>
        </div>
      )}
    </section>
  );
}
