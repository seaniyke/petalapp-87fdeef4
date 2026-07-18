/**
 * Shared brand loader — a petal-mark that gently pulses.
 *
 * Use anywhere a thumbnail / preview / page section is loading. Consistent
 * brand imagery beats spinner-of-the-day.
 */
import logo from "/petal-logo.png";

export function PetalLoader({
  size = 40,
  label,
  className = "",
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`} role="status" aria-live="polite">
      <div className="relative">
        <span
          className="absolute inset-0 animate-ping rounded-full bg-primary/25"
          style={{ animationDuration: "1.6s" }}
          aria-hidden
        />
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          className="relative animate-pulse"
          style={{ width: size, height: size }}
        />
      </div>
      {label ? <p className="text-xs font-medium text-muted-foreground">{label}</p> : null}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
