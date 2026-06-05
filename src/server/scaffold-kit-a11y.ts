/**
 * Phase 17 — A11y + image quality.
 *
 * Three small, opinionated surfaces the AI can compose without re-inventing:
 *
 *   1. ThumbHash placeholders for images so hero/product/cover images fade
 *      in from a tiny (~25 byte) blur instead of flashing white. Eliminates
 *      the "AI site has zero loading polish" tell.
 *
 *   2. react-aria helpers for any custom widget the model invents (sliders,
 *      combobox thumbs, listboxes). Most builds should reach for a shadcn
 *      primitive first, but when they can't this gives them keyboard, focus,
 *      and ARIA correct on the first try.
 *
 *   3. A dev-only axe-core hook so generated apps audit themselves in the
 *      browser console during `bun run dev`. No-op in production.
 *
 * All heavy deps (`thumbhash`, `react-aria`, `@axe-core/react`, `react-dom`)
 * are on-demand only — registered in `known-packages.ts` and pulled in just
 * when one of these files is imported.
 */

import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

/* ------------------------------------------------------------------------- *
 * 1. ThumbHash image
 * ------------------------------------------------------------------------- */

const THUMBHASH_IMAGE = `import * as React from "react";
import { thumbHashToDataURL } from "thumbhash";
import { cn } from "@/lib/utils";

/**
 * <ThumbhashImage> — drop-in <img> replacement that fades from a tiny
 * ThumbHash blur to the real image once it decodes.
 *
 * Usage:
 *   <ThumbhashImage
 *     src="/hero.jpg"
 *     alt="Sunset over Lisbon"
 *     thumbhash="1QcSHQRnh493V4dIh4eXh1h0wPV8DA"  // base64 string
 *     className="aspect-video w-full rounded-2xl"
 *   />
 *
 * The thumbhash string is produced offline (build script or design tool)
 * from the source image — see https://evanw.github.io/thumbhash/.
 *
 * Falls back to a plain <img> if no thumbhash is provided, so it's always
 * safe to swap in for a vanilla <img>.
 */
export interface ThumbhashImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Base64-encoded ThumbHash. Omit to render a plain <img>. */
  thumbhash?: string;
  /** Wrapper className. The <img> stretches to fill the wrapper. */
  className?: string;
  /** Object-fit on the <img>. Defaults to "cover". */
  fit?: "cover" | "contain" | "fill" | "none" | "scale-down";
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const ThumbhashImage = React.forwardRef<HTMLImageElement, ThumbhashImageProps>(
  ({ thumbhash, className, fit = "cover", style, onLoad, alt, ...rest }, ref) => {
    const [loaded, setLoaded] = React.useState(false);

    const placeholder = React.useMemo(() => {
      if (!thumbhash) return null;
      try {
        return thumbHashToDataURL(decodeBase64(thumbhash));
      } catch {
        return null;
      }
    }, [thumbhash]);

    return (
      <span className={cn("relative block overflow-hidden bg-muted", className)}>
        {placeholder ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 bg-cover bg-center transition-opacity duration-500",
              loaded ? "opacity-0" : "opacity-100",
            )}
            style={{ backgroundImage: \`url(\${placeholder})\`, filter: "blur(8px)", transform: "scale(1.05)" }}
          />
        ) : null}
        <img
          ref={ref}
          alt={alt ?? ""}
          loading={rest.loading ?? "lazy"}
          decoding={rest.decoding ?? "async"}
          onLoad={(e) => {
            setLoaded(true);
            onLoad?.(e);
          }}
          style={{ objectFit: fit, ...style }}
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
          )}
          {...rest}
        />
      </span>
    );
  },
);
ThumbhashImage.displayName = "ThumbhashImage";
`;

/* ------------------------------------------------------------------------- *
 * 2. react-aria helpers
 * ------------------------------------------------------------------------- */

const A11Y_LIB = `/**
 * Curated re-exports from react-aria for custom widgets. Use these instead
 * of inventing keyboard/focus handling from scratch.
 *
 *   import { useFocusRing, useButton, useHover, VisuallyHidden, FocusScope }
 *     from "@/lib/a11y";
 *
 * For most cases you should still prefer a shadcn primitive (Button, Dialog,
 * Popover, etc.) — they already wrap Radix and ship correct ARIA. Reach for
 * this module only when you're hand-rolling a widget shadcn doesn't cover
 * (custom slider thumb, drag-to-rearrange list, etc.).
 */
export {
  useFocusRing,
  useButton,
  useHover,
  usePress,
  useFocus,
  useFocusWithin,
  useKeyboard,
  useLongPress,
  VisuallyHidden,
  FocusScope,
  useFocusManager,
  mergeProps,
  chain,
} from "react-aria";
`;

/* ------------------------------------------------------------------------- *
 * 3. axe-core dev hook
 * ------------------------------------------------------------------------- */

const USE_AXE = `import * as React from "react";

/**
 * useAxe — dev-only accessibility auditor. Loads @axe-core/react lazily
 * and reports violations to the browser console while you build. No-op in
 * production builds.
 *
 * Wire it into your root component once:
 *
 *   function App() {
 *     useAxe();
 *     return <RouterProvider ... />;
 *   }
 *
 * Violations show up grouped by impact (critical / serious / moderate /
 * minor) with a link to the rule. Fix the criticals first.
 */
export function useAxe(): void {
  React.useEffect(() => {
    if (import.meta.env.PROD) return;
    if (typeof window === "undefined") return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ default: axe }, React, ReactDOM] = await Promise.all([
          import("@axe-core/react"),
          import("react"),
          import("react-dom"),
        ]);
        if (cancelled) return;
        axe(React, ReactDOM, 1000);
      } catch (err) {
        // Surfacing the failure helps if a dep is missing but never blocks render.
        console.warn("[useAxe] axe-core failed to start:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
`;

/* ------------------------------------------------------------------------- *
 * Reference doc
 * ------------------------------------------------------------------------- */

const A11Y_DOCS = `# A11y + image quality (Phase 17)

Three primitives, all on-demand. Reach for them when the design calls for
hero imagery, custom widgets, or you want dev-time a11y feedback.

## ThumbhashImage — image placeholders

\`\`\`tsx
import { ThumbhashImage } from "@/components/image/thumbhash-image";

<ThumbhashImage
  src="/hero.jpg"
  alt="Sunrise over Lisbon"
  thumbhash="1QcSHQRnh493V4dIh4eXh1h0wPV8DA"
  className="aspect-video w-full rounded-2xl"
/>
\`\`\`

Generate the \`thumbhash\` string offline (build script, design tool, or one-off
script). Stored alongside the image URL. Falls back to a plain <img> when omitted.

## react-aria — custom widgets

Reach for shadcn first. When you must hand-roll a widget:

\`\`\`tsx
import { useButton, useFocusRing, mergeProps } from "@/lib/a11y";

function StarButton() {
  const ref = React.useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ onPress: () => {} }, ref);
  const { focusProps, isFocusVisible } = useFocusRing();
  return (
    <button
      ref={ref}
      {...mergeProps(buttonProps, focusProps)}
      className={isFocusVisible ? "ring-2 ring-ring" : undefined}
    >
      Star
    </button>
  );
}
\`\`\`

## useAxe — dev-time a11y auditor

\`\`\`tsx
import { useAxe } from "@/hooks/use-axe";

function App() {
  useAxe();
  return <RouterProvider ... />;
}
\`\`\`

Logs violations to the browser console in dev only. No-op in production.
Fix critical → serious → moderate → minor in that order.
`;

/* ------------------------------------------------------------------------- *
 * Exports
 * ------------------------------------------------------------------------- */

export const KIT_A11Y_FILES: KitFile[] = [
  { path: "src/components/image/thumbhash-image.tsx", content: THUMBHASH_IMAGE, overwrite: true },
  { path: "src/lib/a11y.ts", content: A11Y_LIB, overwrite: true },
  { path: "src/hooks/use-axe.ts", content: USE_AXE, overwrite: true },
  { path: "src/components/examples/A11Y.md", content: A11Y_DOCS, overwrite: true },
];
