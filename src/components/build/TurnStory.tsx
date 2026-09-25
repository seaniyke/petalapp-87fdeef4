/**
 * The work narrative for one turn — rendered purely from the turn reducer's
 * derived view. Human-first by default; "Technical details" reveals file
 * paths, checks, build info and errors. No timers, no percentages: only
 * things the backend actually reported.
 */
import { useState } from "react";
import { Check, ChevronDown, CircleSlash, Loader2, TriangleAlert } from "lucide-react";
import type { TurnView } from "@/lib/turn-execution/turn-reducer";

const VISIBLE_DONE = 5;

export function TurnStory({ view }: { view: TurnView }) {
  const [showAll, setShowAll] = useState(false);
  const [tech, setTech] = useState(false);
  const done = view.completed;
  const hidden = Math.max(0, done.length - VISIBLE_DONE);
  const shown = showAll ? done : done.slice(-VISIBLE_DONE);

  return (
    <div className="border-t border-border/60 px-3.5 py-2.5" data-testid="turn-story" data-lifecycle={view.lifecycle}>
      {hidden > 0 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mb-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {hidden} earlier step{hidden === 1 ? "" : "s"}
        </button>
      )}
      <ol className="space-y-1">
        {shown.map((a) => (
          <li key={a.key} className="flex items-start gap-2 text-[12.5px] text-muted-foreground animate-fade-in motion-reduce:animate-none">
            <Check className="mt-[3px] h-3 w-3 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0">
              {a.label}
              {tech && a.tech && <code className="ml-1.5 break-all font-mono text-[10.5px] opacity-70">{a.tech}</code>}
            </span>
          </li>
        ))}
        {view.failedSteps.map((a) => (
          <li key={a.key} className="flex items-start gap-2 text-[12.5px] text-destructive">
            <TriangleAlert className="mt-[3px] h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0">
              {a.label}
              {tech && a.tech && <code className="ml-1.5 break-all font-mono text-[10.5px] opacity-80">{a.tech}</code>}
            </span>
          </li>
        ))}
        {view.current && (
          <li key={`cur-${view.current.key}`} className="flex items-start gap-2 text-[13px] font-semibold text-foreground animate-fade-in motion-reduce:animate-none">
            <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden />
            <span className="min-w-0">
              {view.current.label}
              {tech && view.current.tech && <code className="ml-1.5 break-all font-mono text-[10.5px] font-normal opacity-70">{view.current.tech}</code>}
            </span>
          </li>
        )}
        {view.lifecycle === "cancelled" && (
          <li className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
            <CircleSlash className="mt-[3px] h-3 w-3 shrink-0" aria-hidden />
            Stopped. Nothing further will run or be charged.
          </li>
        )}
      </ol>

      {view.tech.length > 0 || view.error ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setTech((t) => !t)}
            aria-expanded={tech}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Technical details
            <ChevronDown className={`h-3 w-3 transition-transform ${tech ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {tech && (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {[
                `state: ${view.lifecycle}`,
                ...(view.error ? [`error${view.error.kind ? ` [${view.error.kind}]` : ""}: ${view.error.raw ?? view.error.message}`] : []),
                ...view.tech.slice(-40),
              ].join("\n")}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
