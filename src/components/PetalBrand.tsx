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
  /** "xs" for the compact site header, "sm" for dense chrome, "md" for pages. */
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const mark =
    size === "xs"
      ? "h-5 w-5"
      : size === "sm"
        ? "h-7 w-7"
        : "h-8 w-8 sm:h-9 sm:w-9";
  const word =
    size === "xs"
      ? "text-[0.95rem] leading-none"
      : size === "sm"
        ? "text-[1.15rem] leading-none sm:text-xl"
        : "text-[1.35rem] leading-none sm:text-[1.55rem]";
  const tagline =
    size === "xs"
      ? "text-[0.38rem] tracking-[0.1em]"
      : "text-[0.46rem] tracking-[0.12em] sm:text-[0.5rem]";
  const gap = size === "xs" ? "gap-2" : "gap-2.5";

  return (
    <span className={`group inline-flex items-center ${gap} ${className}`}>
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
        <span
          className={`mt-0.5 whitespace-nowrap font-brand ${tagline} font-medium uppercase leading-none text-muted-foreground`}
        >
          Build real apps with AI
        </span>
      </span>
    </span>
  );
}
