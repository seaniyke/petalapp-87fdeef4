/**
 * One smooth progress bar with a heartbeat, replacing the flat segment rail.
 * It advances with the stage and shimmers while Kimble is working.
 */
type Props = {
  /** 0..1 */
  value: number;
  active: boolean;
  failed?: boolean;
};

export function ProgressArc({ value, active, failed }: Props) {
  const pct = Math.max(4, Math.min(100, Math.round(value * 100)));
  return (
    <div className="relative h-1 w-full overflow-hidden bg-border/50" aria-hidden>
      <div
        className={`h-full rounded-r-full transition-[width] duration-700 ease-out ${
          failed ? "bg-destructive" : "bg-primary/75"
        }`}
        style={{ width: `${pct}%` }}
      />
      {active && !failed && (
        <div className="pointer-events-none absolute inset-0 petal-shimmer opacity-60 motion-reduce:hidden" />
      )}
    </div>
  );
}
