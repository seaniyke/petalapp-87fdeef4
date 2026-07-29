/**
 * The one true Petal brand lockup — mark + wordmark.
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
      ? "text-xl sm:text-[1.35rem]"
      : "text-2xl sm:text-[1.7rem]";

  return (
    <span className={`group inline-flex items-center gap-2 ${className}`}>
      <img
        src="/petal-logo.png"
        alt=""
        aria-hidden="true"
        className={`${mark} shrink-0 object-contain transition-transform group-hover:-rotate-6`}
      />
      <span
        className={`font-display ${word} font-black tracking-[-0.03em] text-foreground transition-opacity group-hover:opacity-80`}
      >
        Petal
      </span>
    </span>
  );
}
