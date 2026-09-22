/**
 * The pages landing as Kimble writes them — newest first, each sliding in,
 * the live one softly pulsing. Human names, never paths.
 */

/** "src/components/HowItWorks.tsx" → "How it works". */
export function humanFileName(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
  const words = base
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return path;
  const lower = words.toLowerCase();
  if (lower === "index") return "Home";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

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
      {recent.map((p) => {
        const live = p === activePath;
        return (
          <span
            key={p}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none ${
              live
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-muted/50 text-muted-foreground"
            }`}
          >
            {live && (
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />
            )}
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
