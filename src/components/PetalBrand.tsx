/**
 * The one true Kimble brand lockup — mark + wordmark.
 *
 * Every surface (site header, project pages, auth, waitlist) renders this so
 * the logo never drifts in size, weight or spacing between pages.
 */

export function PetalBrand({
  size = "md",
  className = "",
}: {
  /** "sm" for dense chrome, "md" for the standard site header. */
  size?: "sm" | "md";
  className?: string;
}) {
  const mark = size === "sm" ? "h-7 w-7" : "h-8 w-8 sm:h-9 sm:w-9";
  const word =
    size === "sm"
      ? "text-[1.15rem] leading-none sm:text-xl"
      : "text-[1.35rem] leading-none sm:text-[1.55rem]";

  return (
    <span className={`group inline-flex items-center gap-2.5 ${className}`}>
      <img
        src="/kimble-logo.png"
        alt=""
        aria-hidden="true"
        className={`${mark} shrink-0 object-contain transition-transform group-hover:-rotate-6 dark:invert`}
      />
      <span className="flex min-w-0 flex-col justify-center">
        <span
          className={`font-brand ${word} font-bold text-foreground transition-opacity group-hover:opacity-80`}
        >
          Kimble.
        </span>
        <span className="mt-0.5 whitespace-nowrap font-brand text-[0.46rem] font-medium uppercase leading-none tracking-[0.12em] text-muted-foreground sm:text-[0.5rem]">
          Build real apps with AI
        </span>
      </span>
    </span>
  );
}
