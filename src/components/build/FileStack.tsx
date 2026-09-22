/**
 * The pages landing as Kimble writes them — newest first, each sliding in,
 * the live one softly pulsing. Human names, never paths.
 */
import { humanFileName } from "@/lib/human-file-name";

type Props = {
  /** Every path written so far, oldest first. */
  paths: string[];
  /** The one being written right now, if any. */
  activePath?: string | null;
};

export function FileStack({ paths, activePath }: Props) {
  if (paths.length === 0) return null;
  const recent = [...paths].reverse().slice(0, 5);
  const extra = paths.length - recent.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-2.5">
      {recent.map((p, i) => {
        const live = p === activePath;
        return (
          <span
            key={p}
            style={{ animationDelay: `${i * 40}ms` }}
            className={`inline-flex animate-fade-in items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold motion-reduce:animate-none ${
              live
                ? "border-primary/40 bg-primary/10 text-primary animate-pulse"
                : "border-border/60 bg-muted/50 text-muted-foreground"
            }`}
          >
            {humanFileName(p)}
          </span>
        );
      })}
      {extra > 0 && (
        <span className="text-[11px] font-semibold text-muted-foreground/70">+{extra} more</span>
      )}
    </div>
  );
}
