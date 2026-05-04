import { Sparkles, Calendar, ListTodo, Camera, Users, Coffee, Music, ChartBar, Layers, BookOpen, Briefcase, Building2 } from "lucide-react";

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

export type StartIdea = {
  title: string;
  prompt: string;
  Icon: typeof Sparkles;
  accent: "pink" | "mint" | "lilac" | "sky" | "butter";
};

const IDEAS: StartIdea[] = [
  {
    title: "Habit tracker",
    prompt:
      "A minimalist daily habit tracker with streak counts, a 7-day grid, and confetti when I complete all habits for the day.",
    Icon: ListTodo,
    accent: "mint",
  },
  {
    title: "Recipe finder",
    prompt:
      "A recipe finder where I type ingredients I have and get 6 recipe cards back, each with a hero photo, time, and difficulty.",
    Icon: Sparkles,
    accent: "butter",
  },
  {
    title: "Coffee shop site (multi-page)",
    prompt:
      "A warm site for an independent coffee shop called Petal & Bean — separate pages for Home, Menu, Our Story, and Visit Us (with a map). Real /menu, /story and /visit routes, linked from a sticky nav.",
    Icon: Coffee,
    accent: "butter",
  },
  {
    title: "Yoga studio (4 pages)",
    prompt:
      "A 4-page site for a neighborhood yoga studio: home, /classes (with weekly schedule), /instructors (bios + photos), and /contact (form + map). Calm editorial vibe.",
    Icon: Layers,
    accent: "mint",
  },
  {
    title: "Consultancy + case studies",
    prompt:
      "A consultancy website with separate pages for home, /services, /case-studies (index page) plus /case-studies/$slug detail pages, and /about. Confident, editorial tone.",
    Icon: Briefcase,
    accent: "lilac",
  },
  {
    title: "SaaS marketing site",
    prompt:
      "A small SaaS marketing site with proper pages: home, /features, /pricing (3 tiers), /faq, and a /blog index with /blog/$slug detail routes. Modern dev-tool vibe.",
    Icon: Building2,
    accent: "sky",
  },
  {
    title: "Pomodoro timer",
    prompt:
      "A pastel pomodoro timer with 25/5 cycles, a session counter, gentle chime on transitions, and a daily focus stats chart.",
    Icon: ChartBar,
    accent: "lilac",
  },
  {
    title: "Event RSVP page",
    prompt:
      "An RSVP page for a small wedding — hero photo, event details, 'Will you attend?' form, and a guest count that updates live.",
    Icon: Calendar,
    accent: "pink",
  },
  {
    title: "Photo portfolio (multi-page)",
    prompt:
      "A photographer's portfolio with separate pages: home (masonry preview), /gallery (3 collections each on their own /gallery/$slug page), /about, and /contact form.",
    Icon: Camera,
    accent: "sky",
  },
  {
    title: "Writer's blog",
    prompt:
      "A minimalist writer's blog: home with featured posts, /blog index of all posts, /blog/$slug post detail with prose styling, and a short /about page.",
    Icon: BookOpen,
    accent: "butter",
  },
  {
    title: "Team standup board",
    prompt:
      "A team standup board with columns for Yesterday, Today, Blockers — each card has an avatar, name, and timestamp.",
    Icon: Users,
    accent: "mint",
  },
  {
    title: "Mood music picker",
    prompt:
      "A playful 'pick your mood' page that recommends a playlist style — 4 mood tiles, a generated playlist name, and a vibe description.",
    Icon: Music,
    accent: "lilac",
  },
];

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
        {IDEAS.map((idea) => (
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
