/**
 * Petal scaffold kit — the "house style" UI library that gets injected into
 * every newly generated project. Mirrors how Lovable/v0/Base44 work: instead
 * of asking the LLM to emit 12 component files verbatim every turn (slow,
 * expensive, and unreliable), we let the AI emit only app-specific files and
 * server-side merge this kit on top.
 *
 * The kit consists of:
 *   - Tailwind v4 + @tailwindcss/vite (no config file, no PostCSS)
 *   - 12 inlined shadcn-style components in src/components/ui/*
 *   - cn() helper in src/lib/utils.ts
 *   - A pre-themed src/styles.css with semantic tokens (light + dark)
 *
 * Files marked `overwrite: true` always replace whatever the AI emits.
 * Files marked `overwrite: false` only fill in if the AI didn't produce them.
 */
import type { ProjectFile } from "./generate.server";
import { backendKit, BACKEND_DEPS } from "./backend-kit";
import { EXAMPLES_PACK } from "./examples-pack";
import { EXAMPLES_PACK_2 } from "./examples-pack-2";
import { PETAL_SOURCE_PLUGIN } from "./petal-source-plugin";
import { KIT_BLOCK_FILES } from "./scaffold-kit-blocks";
import { KIT_BLOCK_FILES_2 } from "./scaffold-kit-blocks-2";
import { BACKEND_KIT_BLOCK_FILES_3, KIT_BLOCK_FILES_3 } from "./scaffold-kit-blocks-3";
import { KIT_BLOCK_FILES_4 } from "./scaffold-kit-blocks-4";
import { KIT_BLOCK_FILES_MOBILE } from "./scaffold-kit-mobile";
import { KIT_MOTION_FILES } from "./scaffold-kit-motion";
import { KIT_FX_FILES } from "./scaffold-kit-fx";
import { KIT_SHADCN_FILES } from "./scaffold-kit-shadcn";
import { KIT_DATA_FILES } from "./scaffold-kit-data";
import { KIT_TYPOGRAPHY_FILES } from "./scaffold-kit-typography";
import { KIT_CONTENT_FILES } from "./scaffold-kit-content";
import { KIT_AWWWARDS_FILES } from "./scaffold-kit-awwwards";
import { KIT_A11Y_FILES } from "./scaffold-kit-a11y";

type KitFile = ProjectFile & { overwrite: boolean };

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import petalSourcePlugin from "./petal-source-plugin.mjs";

// Resolve "@/..." imports the same way the tsconfig "paths" alias does.
// Vite/Rollup do NOT read tsconfig paths on their own, so without this every
// "@/components/ui/..." import fails the production build.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // \`petalSourcePlugin\` tags JSX with data-source-file/line in DEV ONLY so
  // the in-iframe element picker can report the exact file + line for each
  // click. It no-ops during production builds.
  plugins: [petalSourcePlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    hmr: { clientPort: 443 },
  },
});
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"]
}
`;

export const STYLES_CSS = `@import "tailwindcss";

/* -------------------------------------------------------------------------
 * Self-hosted variable fonts via Fontsource. No Google Fonts CDN hop, no
 * privacy concern, no FOIT/CLS. Add more variable packages per theme:
 *   @import "@fontsource-variable/instrument-serif"; (editorial display)
 *   @import "@fontsource-variable/cormorant";         (luxury serif)
 *   @import "@fontsource-variable/space-grotesk";     (modern tech)
 *   @import "@fontsource-variable/bricolage-grotesque";
 * Then override --font-sans / --font-display below.
 * --------------------------------------------------------------------- */
@import "@fontsource-variable/inter";
@import "@fontsource-variable/jetbrains-mono";

/* Enable class-based dark mode (\`<html class="dark">\`).
   Tailwind v4 also auto-respects the system preference via the dark variant. */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius: 0.625rem;

  /* Font stacks. Override --font-display per theme (editorial → Instrument
     Serif, brutalist → Archivo Black, etc.) by re-declaring in :root. */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
  --font-display: var(--font-sans);
  --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  /* ---------------------------------------------------------------------
   * Fluid type scale (Utopia-style clamp).
   * Min @ 320px viewport, max @ 1280px viewport. Each step generates
   * \`text-step-*\` utilities. Use for headings/body so type breathes
   * across mobile → desktop without media queries.
   *   --text-step--1   small print / captions   12 → 14
   *   --text-step-0    body                     16 → 18
   *   --text-step-1    lead                     18 → 22
   *   --text-step-2    h4                       22 → 28
   *   --text-step-3    h3                       26 → 36
   *   --text-step-4    h2                       32 → 48
   *   --text-step-5    h1                       40 → 64
   *   --text-step-6    display                  48 → 88
   * ------------------------------------------------------------------- */
  --text-step--1: clamp(0.75rem, 0.71rem + 0.21vw, 0.875rem);
  --text-step-0:  clamp(1rem, 0.93rem + 0.42vw, 1.125rem);
  --text-step-1:  clamp(1.125rem, 0.99rem + 0.83vw, 1.375rem);
  --text-step-2:  clamp(1.375rem, 1.13rem + 1.46vw, 1.75rem);
  --text-step-3:  clamp(1.625rem, 1.31rem + 1.88vw, 2.25rem);
  --text-step-4:  clamp(2rem, 1.5rem + 2.92vw, 3rem);
  --text-step-5:  clamp(2.5rem, 1.75rem + 4.58vw, 4rem);
  --text-step-6:  clamp(3rem, 1.83rem + 7.08vw, 5.5rem);

  /* Tracking (letter-spacing) presets — display type wants tighter. */
  --tracking-tightest: -0.04em;
  --tracking-tighter:  -0.03em;
  --tracking-tight:    -0.015em;
}

:root {
  --background: oklch(0.99 0.005 90);
  --foreground: oklch(0.18 0.02 280);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.18 0.02 280);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.18 0.02 280);
  --primary: oklch(0.55 0.18 280);
  --primary-foreground: oklch(0.99 0.005 90);
  --secondary: oklch(0.96 0.01 280);
  --secondary-foreground: oklch(0.22 0.03 280);
  --muted: oklch(0.96 0.01 280);
  --muted-foreground: oklch(0.5 0.02 280);
  --accent: oklch(0.92 0.04 320);
  --accent-foreground: oklch(0.22 0.03 280);
  --destructive: oklch(0.6 0.22 25);
  --destructive-foreground: oklch(0.99 0.005 90);
  --border: oklch(0.92 0.01 280);
  --input: oklch(0.92 0.01 280);
  --ring: oklch(0.55 0.18 280);
}

.dark {
  --background: oklch(0.16 0.02 280);
  --foreground: oklch(0.96 0.01 90);
  --card: oklch(0.20 0.02 280);
  --card-foreground: oklch(0.96 0.01 90);
  --popover: oklch(0.20 0.02 280);
  --popover-foreground: oklch(0.96 0.01 90);
  --primary: oklch(0.72 0.16 280);
  --primary-foreground: oklch(0.16 0.02 280);
  --secondary: oklch(0.26 0.02 280);
  --secondary-foreground: oklch(0.96 0.01 90);
  --muted: oklch(0.26 0.02 280);
  --muted-foreground: oklch(0.7 0.02 280);
  --accent: oklch(0.32 0.05 320);
  --accent-foreground: oklch(0.96 0.01 90);
  --destructive: oklch(0.55 0.22 25);
  --destructive-foreground: oklch(0.98 0.01 90);
  --border: oklch(0.28 0.02 280);
  --input: oklch(0.28 0.02 280);
  --ring: oklch(0.72 0.16 280);
}

/* Auto-apply dark tokens when the OS prefers dark, unless the app explicitly
   set a theme on <html> (\`.light\` or \`.dark\`). */
@media (prefers-color-scheme: dark) {
  :root:not(.light):not(.dark) {
    --background: oklch(0.16 0.02 280);
    --foreground: oklch(0.96 0.01 90);
    --card: oklch(0.20 0.02 280);
    --card-foreground: oklch(0.96 0.01 90);
    --popover: oklch(0.20 0.02 280);
    --popover-foreground: oklch(0.96 0.01 90);
    --primary: oklch(0.72 0.16 280);
    --primary-foreground: oklch(0.16 0.02 280);
    --secondary: oklch(0.26 0.02 280);
    --secondary-foreground: oklch(0.96 0.01 90);
    --muted: oklch(0.26 0.02 280);
    --muted-foreground: oklch(0.7 0.02 280);
    --accent: oklch(0.32 0.05 320);
    --accent-foreground: oklch(0.96 0.01 90);
    --destructive: oklch(0.55 0.22 25);
    --destructive-foreground: oklch(0.98 0.01 90);
    --border: oklch(0.28 0.02 280);
    --input: oklch(0.28 0.02 280);
    --ring: oklch(0.72 0.16 280);
  }
}

html, body, #root { height: 100%; }
body {
  font-family: var(--font-sans);
  font-size: var(--text-step-0);
  background: var(--color-background);
  color: var(--color-foreground);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Display utility for hero/h1 type — uses the display font + tightest
   tracking. Apply with \`<h1 className="font-display">\`. */
.font-display { font-family: var(--font-display); letter-spacing: var(--tracking-tightest); }
.font-serif { font-family: var(--font-serif); }
.font-mono { font-family: var(--font-mono); }

/* Fluid type utilities, exposed as plain class names so the AI can write
   \`<h1 className="text-step-5 font-display">\` without inventing styles. */
.text-step--1 { font-size: var(--text-step--1); line-height: 1.4; }
.text-step-0  { font-size: var(--text-step-0);  line-height: 1.6; }
.text-step-1  { font-size: var(--text-step-1);  line-height: 1.5; }
.text-step-2  { font-size: var(--text-step-2);  line-height: 1.3; letter-spacing: var(--tracking-tight); }
.text-step-3  { font-size: var(--text-step-3);  line-height: 1.2; letter-spacing: var(--tracking-tight); }
.text-step-4  { font-size: var(--text-step-4);  line-height: 1.1; letter-spacing: var(--tracking-tighter); }
.text-step-5  { font-size: var(--text-step-5);  line-height: 1.05; letter-spacing: var(--tracking-tighter); }
.text-step-6  { font-size: var(--text-step-6);  line-height: 1; letter-spacing: var(--tracking-tightest); }
`;


const UTILS_TS = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const BUTTON = `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";
export { buttonVariants };
`;

const CARD = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)} {...props} />
  )
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";
`;

const INPUT = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
`;

// Self-contained OTP input. Mirrors the shadcn/ui input-otp public API
// (<InputOTP maxLength value onChange>, <InputOTPGroup>, <InputOTPSlot index>,
// <InputOTPSeparator />) so the auth/onboarding example blocks compile without
// pulling the `input-otp` npm package. Backed by a single hidden <input>; the
// visible slot boxes are pure UI driven from context. Good enough for >95% of
// product use cases (sign-up codes, 2FA, magic-link verification).
const INPUT_OTP = `import * as React from "react";
import { cn } from "@/lib/utils";

type OTPCtx = {
  value: string;
  maxLength: number;
  setValue: (v: string) => void;
  focusedIndex: number;
  setFocusedIndex: (i: number) => void;
};
const OTPContext = React.createContext<OTPCtx | null>(null);

function useOTP(): OTPCtx {
  const ctx = React.useContext(OTPContext);
  if (!ctx) throw new Error("InputOTP slots must be used inside <InputOTP>");
  return ctx;
}

export interface InputOTPProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  maxLength?: number;
  value?: string;
  onChange?: (value: string) => void;
  containerClassName?: string;
  children: React.ReactNode;
}

export const InputOTP = React.forwardRef<HTMLInputElement, InputOTPProps>(
  ({ maxLength = 6, value, onChange, containerClassName, className, children, disabled, ...rest }, ref) => {
    const [internal, setInternal] = React.useState("");
    const isControlled = value !== undefined;
    const current = isControlled ? value! : internal;
    const [focusedIndex, setFocusedIndex] = React.useState(-1);
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const setValue = React.useCallback(
      (next: string) => {
        const cleaned = next.replace(/\\D/g, "").slice(0, maxLength);
        if (!isControlled) setInternal(cleaned);
        onChange?.(cleaned);
      },
      [isControlled, maxLength, onChange],
    );

    return (
      <OTPContext.Provider value={{ value: current, maxLength, setValue, focusedIndex, setFocusedIndex }}>
        <div
          className={cn("relative flex items-center gap-2", containerClassName)}
          onClick={() => inputRef.current?.focus()}
        >
          {children}
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={current}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocusedIndex(Math.min(current.length, maxLength - 1))}
            onBlur={() => setFocusedIndex(-1)}
            maxLength={maxLength}
            className={cn(
              "absolute inset-0 h-full w-full opacity-0 outline-none disabled:cursor-not-allowed",
              className,
            )}
            {...rest}
          />
        </div>
      </OTPContext.Provider>
    );
  },
);
InputOTP.displayName = "InputOTP";

export const InputOTPGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center", className)} {...props} />
  ),
);
InputOTPGroup.displayName = "InputOTPGroup";

export interface InputOTPSlotProps extends React.HTMLAttributes<HTMLDivElement> {
  index: number;
}
export const InputOTPSlot = React.forwardRef<HTMLDivElement, InputOTPSlotProps>(
  ({ index, className, ...props }, ref) => {
    const { value, focusedIndex } = useOTP();
    const char = value[index] ?? "";
    const isActive = focusedIndex === index || (focusedIndex === -1 && index === value.length);
    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 items-center justify-center border-y border-r border-input text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
          isActive && "z-10 ring-2 ring-ring ring-offset-background",
          className,
        )}
        {...props}
      >
        {char}
        {isActive && !char && (
          <span className="pointer-events-none absolute inset-y-2 w-px animate-pulse bg-foreground" aria-hidden />
        )}
      </div>
    );
  },
);
InputOTPSlot.displayName = "InputOTPSlot";

export const InputOTPSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} role="separator" className={cn("text-muted-foreground", className)} {...props}>
      <span aria-hidden>-</span>
    </div>
  ),
);
InputOTPSeparator.displayName = "InputOTPSeparator";
`;

// Pagination — thin nav primitive. Mirrors shadcn's surface area
// (Pagination, PaginationContent, PaginationItem, PaginationLink,
// PaginationPrevious, PaginationNext, PaginationEllipsis) so paginated
// tables in examples compile out of the box.
const PAGINATION = `import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export const Pagination = ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
  <nav role="navigation" aria-label="pagination" className={cn("mx-auto flex w-full justify-center", className)} {...props} />
);
Pagination.displayName = "Pagination";

export const PaginationContent = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn("flex flex-row items-center gap-1", className)} {...props} />
  ),
);
PaginationContent.displayName = "PaginationContent";

export const PaginationItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn("", className)} {...props} />,
);
PaginationItem.displayName = "PaginationItem";

export interface PaginationLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  isActive?: boolean;
  size?: "default" | "sm" | "lg" | "icon";
}
export const PaginationLink = ({ className, isActive, size = "icon", ...props }: PaginationLinkProps) => (
  <a
    aria-current={isActive ? "page" : undefined}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      isActive ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground",
      size === "icon" ? "h-10 w-10" : size === "sm" ? "h-9 px-3" : size === "lg" ? "h-11 px-8" : "h-10 px-4 py-2",
      className,
    )}
    {...props}
  />
);
PaginationLink.displayName = "PaginationLink";

export const PaginationPrevious = ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <PaginationLink aria-label="Go to previous page" size="default" className={cn("gap-1 pl-2.5", className)} {...props}>
    <ChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

export const PaginationNext = ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <PaginationLink aria-label="Go to next page" size="default" className={cn("gap-1 pr-2.5", className)} {...props}>
    <span>Next</span>
    <ChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

export const PaginationEllipsis = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span aria-hidden className={cn("flex h-9 w-9 items-center justify-center", className)} {...props}>
    <MoreHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";
`;

// AlertDialog — Dialog variant for destructive/blocking confirms. Same
// surface as shadcn's alert-dialog so the destructive-confirm example
// compiles. Implemented as a controlled portal-less modal (kept simple to
// avoid pulling @radix-ui/react-alert-dialog).
const ALERT_DIALOG = `import * as React from "react";
import { cn } from "@/lib/utils";

type Ctx = { open: boolean; onOpenChange: (o: boolean) => void };
const AlertDialogContext = React.createContext<Ctx | null>(null);

export interface AlertDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}
export function AlertDialog({ open, defaultOpen = false, onOpenChange, children }: AlertDialogProps) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const value = isControlled ? open! : internal;
  const setValue = (next: boolean) => {
    if (!isControlled) setInternal(next);
    onOpenChange?.(next);
  };
  return (
    <AlertDialogContext.Provider value={{ open: value, onOpenChange: setValue }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

function useAlertDialog() {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx) throw new Error("AlertDialog subcomponents must be inside <AlertDialog>");
  return ctx;
}

export interface AlertDialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}
export const AlertDialogTrigger = React.forwardRef<HTMLButtonElement, AlertDialogTriggerProps>(
  ({ asChild, onClick, children, ...props }, ref) => {
    const { onOpenChange } = useAlertDialog();
    const handle = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (!e.defaultPrevented) onOpenChange(true);
    };
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }>;
      return React.cloneElement(child, {
        onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
          child.props.onClick?.(e);
          handle(e);
        },
      });
    }
    return <button ref={ref} type="button" onClick={handle} {...props}>{children}</button>;
  },
);
AlertDialogTrigger.displayName = "AlertDialogTrigger";

export const AlertDialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { open, onOpenChange } = useAlertDialog();
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
        <div
          ref={ref}
          role="alertdialog"
          aria-modal="true"
          className={cn(
            "relative z-10 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  },
);
AlertDialogContent.displayName = "AlertDialogContent";

export const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

export const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

export const AlertDialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
  ),
);
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
AlertDialogDescription.displayName = "AlertDialogDescription";

export const AlertDialogAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, onClick, ...props }, ref) => {
    const { onOpenChange } = useAlertDialog();
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onOpenChange(false);
        }}
        {...props}
      />
    );
  },
);
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, onClick, ...props }, ref) => {
    const { onOpenChange } = useAlertDialog();
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "mt-2 inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:mt-0",
          className,
        )}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onOpenChange(false);
        }}
        {...props}
      />
    );
  },
);
AlertDialogCancel.displayName = "AlertDialogCancel";
`;


const TEXTAREA = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
`;

const LABEL = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  )
);
Label.displayName = "Label";
`;

const BADGE = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { badgeVariants };
`;

const SEPARATOR = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Separator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }
>(({ className, orientation = "horizontal", ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className
    )}
    {...props}
  />
));
Separator.displayName = "Separator";
`;

const AVATAR = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Avatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted", className)} {...props} />
  )
);
Avatar.displayName = "Avatar";

export const AvatarImage = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  ({ className, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/alt-text
    <img ref={ref} className={cn("aspect-square h-full w-full object-cover", className)} {...props} />
  )
);
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex h-full w-full items-center justify-center text-sm font-medium", className)} {...props} />
  )
);
AvatarFallback.displayName = "AvatarFallback";
`;

const ALERT = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive: "border-destructive/50 text-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  )
);
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
  )
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  )
);
AlertDescription.displayName = "AlertDescription";
`;

const SKELETON = `import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
`;

const SWITCH = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onChange, ...props }, ref) => (
    <label className={cn("relative inline-flex h-6 w-11 cursor-pointer items-center", className)}>
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
        {...props}
      />
      <span className="absolute inset-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-disabled:opacity-50" />
      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5" />
    </label>
  )
);
Switch.displayName = "Switch";
`;

const TABS = `import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = { value: string; setValue: (v: string) => void };
const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const value = controlled ?? internal;
  const setValue = (v: string) => {
    if (controlled === undefined) setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ value, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be used inside Tabs");
  const active = ctx.value === value;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be used inside Tabs");
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={cn("mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props}>
      {children}
    </div>
  );
}
`;

const DIALOG = `import * as React from "react";
import { cn } from "@/lib/utils";

type DialogContextValue = { open: boolean; setOpen: (v: boolean) => void };
const DialogContext = React.createContext<DialogContextValue | null>(null);

export function Dialog({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({ asChild: _asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("DialogTrigger must be inside Dialog");
  return React.cloneElement(children, { onClick: () => ctx.setOpen(true) } as React.HTMLAttributes<HTMLElement>);
}

export function DialogContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("DialogContent must be inside Dialog");
  if (!ctx.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => ctx.setOpen(false)} />
      <div
        role="dialog"
        className={cn("relative z-10 w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg", className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />;
}
`;

const SELECT = `import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

// shadcn/ui-compatible Select. The full compound API
// (Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
// SelectGroup, SelectLabel, SelectSeparator) is exported because
// every LLM trained on shadcn reflexively reaches for these names.
// Without all of them present, generated CRUD apps fail to build
// the moment a dropdown shows up.

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
`;

const CHECKBOX = `import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onChange, ...props }, ref) => (
    <label className={cn("relative inline-flex h-4 w-4 items-center justify-center", className)}>
      <input type="checkbox" ref={ref} checked={checked} onChange={onChange} className="peer sr-only" {...props} />
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary bg-background peer-checked:bg-primary peer-checked:text-primary-foreground peer-disabled:opacity-50">
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
    </label>
  )
);
Checkbox.displayName = "Checkbox";
`;

const RADIO_GROUP = `import * as React from "react";
import { cn } from "@/lib/utils";

type RadioContextValue = { name: string; value?: string; onValueChange?: (v: string) => void };
const RadioContext = React.createContext<RadioContextValue | null>(null);

export function RadioGroup({
  value,
  onValueChange,
  name,
  className,
  children,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  name?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const generatedName = React.useId();
  return (
    <RadioContext.Provider value={{ name: name ?? generatedName, value, onValueChange }}>
      <div role="radiogroup" className={cn("grid gap-2", className)}>{children}</div>
    </RadioContext.Provider>
  );
}

export function RadioGroupItem({ value, className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "name"> & { value: string }) {
  const ctx = React.useContext(RadioContext);
  if (!ctx) throw new Error("RadioGroupItem must be inside RadioGroup");
  const checked = ctx.value === value;
  return (
    <label className={cn("relative inline-flex h-4 w-4 items-center justify-center", className)}>
      <input
        type="radio"
        name={ctx.name}
        value={value}
        checked={checked}
        onChange={() => ctx.onValueChange?.(value)}
        className="peer sr-only"
        {...props}
      />
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary bg-background peer-disabled:opacity-50">
        {checked ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
      </span>
    </label>
  );
}
`;

const SLIDER = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, ...props }, ref) => (
    <input
      type="range"
      ref={ref}
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Slider.displayName = "Slider";
`;

const PROGRESS = `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number; // 0-100
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <div className="h-full bg-primary transition-all" style={{ width: \`\${Math.max(0, Math.min(100, value))}%\` }} />
    </div>
  )
);
Progress.displayName = "Progress";
`;

const TOOLTIP = `import * as React from "react";
import { cn } from "@/lib/utils";

export function Tooltip({ children, content, side = "top", className }: {
  children: React.ReactElement;
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const sideClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };
  return (
    <span className="relative inline-flex">
      {React.cloneElement(children, {
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      } as React.HTMLAttributes<HTMLElement>)}
      {open ? (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background shadow",
            sideClasses[side],
            className
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
`;

const POPOVER = `import * as React from "react";
import { cn } from "@/lib/utils";

type PopoverContextValue = { open: boolean; setOpen: (v: boolean) => void };
const PopoverContext = React.createContext<PopoverContextValue | null>(null);

export function Popover({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return <PopoverContext.Provider value={{ open, setOpen }}>{children}</PopoverContext.Provider>;
}

export function PopoverTrigger({ asChild: _asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error("PopoverTrigger must be inside Popover");
  return React.cloneElement(children, { onClick: () => ctx.setOpen(!ctx.open) } as React.HTMLAttributes<HTMLElement>);
}

export function PopoverContent({ className, align = "center", children, ...props }: React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "center" | "end" }) {
  const ctx = React.useContext(PopoverContext);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ctx?.open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ctx.setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") ctx.setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onEsc); };
  }, [ctx]);
  if (!ctx?.open) return null;
  const alignClass = align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div className={cn("absolute z-50 mt-2", alignClass)}>
      <div
        ref={ref}
        className={cn("min-w-[8rem] rounded-md border bg-popover p-4 text-popover-foreground shadow-md", className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}
`;

const DROPDOWN_MENU = `import * as React from "react";
import { cn } from "@/lib/utils";

type Ctx = { open: boolean; setOpen: (v: boolean) => void };
const DMCtx = React.createContext<Ctx | null>(null);

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return <DMCtx.Provider value={{ open, setOpen }}>{children}</DMCtx.Provider>;
}

export function DropdownMenuTrigger({ asChild: _asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(DMCtx);
  if (!ctx) throw new Error("DropdownMenuTrigger must be inside DropdownMenu");
  return React.cloneElement(children, { onClick: () => ctx.setOpen(!ctx.open) } as React.HTMLAttributes<HTMLElement>);
}

export function DropdownMenuContent({ className, align = "end", children, ...props }: React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }) {
  const ctx = React.useContext(DMCtx);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ctx?.open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ctx.setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") ctx.setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onEsc); };
  }, [ctx]);
  if (!ctx?.open) return null;
  const alignClass = align === "end" ? "right-0" : "left-0";
  return (
    <div className={cn("absolute z-50 mt-2", alignClass)}>
      <div
        ref={ref}
        role="menu"
        className={cn("min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md", className)}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export function DropdownMenuItem({ className, onSelect, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { onSelect?: () => void }) {
  const ctx = React.useContext(DMCtx);
  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={() => { onSelect?.(); ctx?.setOpen(false); }}
      className={cn("relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-2 py-1.5 text-sm font-semibold", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />;
}
`;

const ACCORDION = `import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type AccordionContextValue = {
  type: "single" | "multiple";
  value: string[];
  toggle: (v: string) => void;
};
const AccordionContext = React.createContext<AccordionContextValue | null>(null);

export function Accordion({
  type = "single",
  defaultValue,
  className,
  children,
}: {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  className?: string;
  children: React.ReactNode;
}) {
  const initial = Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [];
  const [value, setValue] = React.useState<string[]>(initial);
  const toggle = (v: string) => {
    setValue((cur) => {
      if (cur.includes(v)) return cur.filter((x) => x !== v);
      return type === "single" ? [v] : [...cur, v];
    });
  };
  return (
    <AccordionContext.Provider value={{ type, value, toggle }}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

const ItemCtx = React.createContext<string>("");

export function AccordionItem({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  return (
    <ItemCtx.Provider value={value}>
      <div className={cn("border-b", className)}>{children}</div>
    </ItemCtx.Provider>
  );
}

export function AccordionTrigger({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = React.useContext(AccordionContext);
  const item = React.useContext(ItemCtx);
  const open = !!ctx?.value.includes(item);
  return (
    <button
      type="button"
      onClick={() => ctx?.toggle(item)}
      aria-expanded={open}
      className={cn("flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline w-full", className)}
      {...props}
    >
      {children}
      <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
    </button>
  );
}

export function AccordionContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(AccordionContext);
  const item = React.useContext(ItemCtx);
  const open = !!ctx?.value.includes(item);
  if (!open) return null;
  return (
    <div className={cn("overflow-hidden text-sm pb-4 pt-0", className)} {...props}>
      {children}
    </div>
  );
}
`;

const SCROLL_AREA = `import * as React from "react";
import { cn } from "@/lib/utils";

export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative overflow-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
ScrollArea.displayName = "ScrollArea";
`;

const TABLE = `import * as React from "react";
import { cn } from "@/lib/utils";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
);
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
);
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium", className)} {...props} />
);
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)} {...props} />
  )
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th ref={ref} className={cn("h-10 px-2 text-left align-middle font-medium text-muted-foreground", className)} {...props} />
  )
);
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("p-2 align-middle", className)} {...props} />
  )
);
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  )
);
TableCaption.displayName = "TableCaption";
`;

const SHEET = `import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type SheetContextValue = { open: boolean; setOpen: (v: boolean) => void };
const SheetContext = React.createContext<SheetContextValue | null>(null);

export function Sheet({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>;
}

export function SheetTrigger({ asChild: _asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(SheetContext);
  if (!ctx) throw new Error("SheetTrigger must be inside Sheet");
  return React.cloneElement(children, { onClick: () => ctx.setOpen(true) } as React.HTMLAttributes<HTMLElement>);
}

export function SheetContent({
  side = "right",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { side?: "top" | "right" | "bottom" | "left" }) {
  const ctx = React.useContext(SheetContext);
  if (!ctx?.open) return null;
  const sideClass: Record<string, string> = {
    right: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l",
    left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r",
    top: "inset-x-0 top-0 h-1/3 border-b",
    bottom: "inset-x-0 bottom-0 h-1/3 border-t",
  };
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={() => ctx.setOpen(false)} />
      <div
        className={cn("absolute bg-background p-6 shadow-lg transition-all", sideClass[side], className)}
        {...props}
      >
        <button
          type="button"
          onClick={() => ctx.setOpen(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold text-foreground", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />;
}
`;

const TOAST = `// Re-exports sonner for a familiar shadcn-style toast API.
// Mount <Toaster /> once at the root, then call \`toast(...)\`, \`toast.success(...)\`, etc.
export { Toaster } from "sonner";
export { toast } from "sonner";
`;

const THEME_PROVIDER = `import * as React from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "ui-theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): "light" | "dark" {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  // Only add an explicit class when the user picked one. For "system" we let
  // the CSS \`prefers-color-scheme\` media query handle it (no class).
  if (theme !== "system") root.classList.add(resolved);
  return resolved;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? defaultTheme;
  });
  const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    setResolvedTheme(applyTheme(theme));
  }, [theme]);

  React.useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyTheme("system"));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
`;

const THEME_TOGGLE = `import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/ui/theme-provider";

export function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setTheme("light")}>
          <Sun className="mr-2 h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")}>
          <Moon className="mr-2 h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
`;

const ROUTER = `/**
 * Thin, opinionated re-export of react-router-dom for the Petal kit.
 *
 * Use this for any multi-page app. Define <Route> children once in App.tsx,
 * use <Link to="/about"> for navigation, useNavigate() for programmatic moves,
 * and useParams() for dynamic segments like "/post/:id".
 *
 * Common pattern (in App.tsx):
 *   import { Router, Routes, Route, Link, NavLink, Outlet } from "@/components/ui/router";
 *   <Router>
 *     <Routes>
 *       <Route element={<SiteLayout />}>
 *         <Route path="/" element={<HomePage />} />
 *         <Route path="/about" element={<AboutPage />} />
 *         <Route path="/post/:slug" element={<PostPage />} />
 *         <Route path="*" element={<NotFoundPage />} />
 *       </Route>
 *     </Routes>
 *   </Router>
 *
 * SiteLayout renders the shared header/footer and an <Outlet /> where the
 * matched child route is rendered. Use <NavLink> in headers — its
 * \`isActive\` render-prop child or \`className\` callback gives you free
 * active styling.
 */
export {
  BrowserRouter,
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  NavLink,
  Outlet,
  Navigate,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useNavigate,
  useParams,
  useLocation,
  useSearchParams,
} from "react-router-dom";

export type { RouteObject } from "react-router-dom";
`;

const CONTAINER = `import * as React from "react";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
  full: "max-w-none",
} as const;

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: keyof typeof sizeMap;
}

/** Centered max-width wrapper with sensible horizontal padding. */
export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, size = "lg", ...props }, ref) => (
    <div
      ref={ref}
      className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", sizeMap[size], className)}
      {...props}
    />
  ),
);
Container.displayName = "Container";
`;

const STACK = `import * as React from "react";
import { cn } from "@/lib/utils";

const gapMap = {
  0: "gap-0",
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
  12: "gap-12",
} as const;

const alignMap = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
} as const;

const justifyMap = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
} as const;

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: keyof typeof gapMap;
  align?: keyof typeof alignMap;
  justify?: keyof typeof justifyMap;
}

/** Vertical flex stack. Use for any column of elements. */
export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ className, gap = 4, align, justify, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col",
        gapMap[gap],
        align && alignMap[align],
        justify && justifyMap[justify],
        className,
      )}
      {...props}
    />
  ),
);
Stack.displayName = "Stack";

// Re-export Inline from its dedicated file so existing imports keep working.
export { Inline, type InlineProps } from "./inline";
// Internal helper exports — used by inline.tsx so the maps stay in sync.
export { gapMap as _gapMap, alignMap as _alignMap, justifyMap as _justifyMap };
`;

const INLINE = `import * as React from "react";
import { cn } from "@/lib/utils";
import { _gapMap as gapMap, _alignMap as alignMap, _justifyMap as justifyMap } from "./stack";

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: keyof typeof gapMap;
  align?: keyof typeof alignMap;
  justify?: keyof typeof justifyMap;
  /** Allow children to wrap to the next line on overflow. */
  wrap?: boolean;
}

/**
 * Horizontal flex row. Use for inline groups: toolbars, button rows, badge
 * clusters, icon + label pairs. Items are vertically centered by default.
 *
 * \`\`\`tsx
 * <Inline gap={2} justify="between">
 *   <Inline gap={2}><Icon /><span>Label</span></Inline>
 *   <Button>Save</Button>
 * </Inline>
 * \`\`\`
 */
export const Inline = React.forwardRef<HTMLDivElement, InlineProps>(
  ({ className, gap = 2, align = "center", justify, wrap, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-row",
        gapMap[gap],
        alignMap[align],
        justify && justifyMap[justify],
        wrap && "flex-wrap",
        className,
      )}
      {...props}
    />
  ),
);
Inline.displayName = "Inline";
`;

const GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

const gapMap = {
  0: "gap-0",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
  12: "gap-12",
} as const;

// Static class strings so Tailwind's JIT can detect every variant.
const colsBase = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  6: "grid-cols-6",
  12: "grid-cols-12",
} as const;
const colsSm = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  6: "sm:grid-cols-6",
  12: "sm:grid-cols-12",
} as const;
const colsMd = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  6: "md:grid-cols-6",
  12: "md:grid-cols-12",
} as const;
const colsLg = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  6: "lg:grid-cols-6",
  12: "lg:grid-cols-12",
} as const;

type Cols = keyof typeof colsBase;
type Gap = keyof typeof gapMap;

/**
 * Named responsive layouts for common dashboard / marketing patterns.
 * Each preset maps to { cols, sm?, md?, lg?, gap }. Explicit props override the preset.
 */
const presets = {
  /** Stat cards across the top of a dashboard: 1 -> 2 -> 4. */
  stats: { cols: 1, sm: 2, lg: 4, gap: 4 },
  /** KPI tiles, denser than \`stats\`: 2 -> 4 -> 6. */
  kpis: { cols: 2, sm: 4, lg: 6, gap: 3 },
  /** Standard dashboard widget grid: 1 -> 2 -> 3. */
  dashboard: { cols: 1, md: 2, lg: 3, gap: 6 },
  /** Card grid for product / feature listings: 1 -> 2 -> 3 -> 4. */
  cards: { cols: 1, sm: 2, md: 3, lg: 4, gap: 6 },
  /** Marketing feature grid: 1 -> 2 -> 3. */
  features: { cols: 1, md: 2, lg: 3, gap: 8 },
  /** Pricing tiers: 1 -> 3. */
  pricing: { cols: 1, md: 3, gap: 6 },
  /** Two-column layout (e.g. main + sidebar at desktop). */
  split: { cols: 1, md: 2, gap: 6 },
  /** Photo / media gallery: 2 -> 3 -> 4. */
  gallery: { cols: 2, sm: 3, lg: 4, gap: 3 },
} as const satisfies Record<string, { cols: Cols; sm?: Cols; md?: Cols; lg?: Cols; gap: Gap }>;

export type GridPreset = keyof typeof presets;

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Named layout preset. Explicit cols/sm/md/lg/gap override preset values. */
  preset?: GridPreset;
  /** Default column count (mobile-first). */
  cols?: Cols;
  /** Column count at >=640px. */
  sm?: Cols;
  /** Column count at >=768px. */
  md?: Cols;
  /** Column count at >=1024px. */
  lg?: Cols;
  gap?: Gap;
}

/**
 * Responsive CSS grid.
 * Use a preset for common patterns: \`<Grid preset="dashboard" />\`.
 * Or compose manually: \`<Grid cols={1} md={2} lg={3} gap={6} />\`.
 */
export const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  ({ className, preset, cols, sm, md, lg, gap, ...props }, ref) => {
    const p = preset ? presets[preset] : undefined;
    const _cols = (cols ?? p?.cols ?? 1) as Cols;
    const _sm = (sm ?? p?.sm) as Cols | undefined;
    const _md = (md ?? p?.md) as Cols | undefined;
    const _lg = (lg ?? p?.lg) as Cols | undefined;
    const _gap = (gap ?? p?.gap ?? 4) as Gap;
    return (
      <div
        ref={ref}
        className={cn(
          "grid",
          colsBase[_cols],
          _sm && colsSm[_sm],
          _md && colsMd[_md],
          _lg && colsLg[_lg],
          gapMap[_gap],
          className,
        )}
        {...props}
      />
    );
  },
);
Grid.displayName = "Grid";
`;

/**
 * Layout primitives tutorial. Lives under src/components/examples/ as a
 * read-only markdown reference the AI can consult when laying out pages.
 * NOT imported by app code — pure documentation.
 */
const LAYOUT_DOCS = `# Layout Primitives — Container, Stack, Inline, Grid

These four components handle ~90% of page layout in this scaffold. Reach for
them BEFORE writing raw \`flex\`, \`grid\`, or \`gap-N\` utility chains by hand.

---

## When to use what (decision tree)

- Centering a page or section horizontally with comfortable side padding -> **Container**
- A vertical column of elements (form fields, list items, page sections) -> **Stack**
- A horizontal row of small items (toolbar, button row, badges, breadcrumb) -> **Inline**
- A responsive multi-column layout (cards, stats, dashboard widgets) -> **Grid**

If you find yourself typing \`className="flex flex-col gap-..."\` -> use \`<Stack>\`.
If you find yourself typing \`className="flex items-center gap-..."\` -> use \`<Inline>\`.
If you find yourself typing \`className="grid grid-cols-1 md:grid-cols-..."\` -> use \`<Grid>\`.

---

## Container

Centered max-width wrapper with sensible horizontal padding. Use as the
outermost wrapper inside every page section.

\`\`\`tsx
import { Container } from "@/components/ui/container";

<Container size="lg">
  {/* page content */}
</Container>
\`\`\`

**Props**

| prop  | values                              | default | when to use                                  |
|-------|-------------------------------------|---------|----------------------------------------------|
| size  | "sm" \\| "md" \\| "lg" \\| "xl" \\| "full" | "lg"    | "sm" for forms/auth, "lg" for most pages, "xl" for dashboards, "full" for edge-to-edge |

\`Container\` already applies \`mx-auto w-full px-4 sm:px-6 lg:px-8\`. Do NOT
add your own horizontal padding to it — just nest content inside.

---

## Stack — vertical column

\`\`\`tsx
import { Stack } from "@/components/ui/stack";

<Stack gap={6}>
  <h1 className="text-3xl font-semibold">Settings</h1>
  <p className="text-muted-foreground">Manage your preferences below.</p>
  <Card>...</Card>
  <Card>...</Card>
</Stack>
\`\`\`

**Props**

| prop    | values                              | default | notes                                  |
|---------|-------------------------------------|---------|----------------------------------------|
| gap     | 0,1,2,3,4,5,6,8,10,12               | 4       | use 4 for tight, 6 for comfortable, 8/10/12 for major page sections |
| align   | "start" \\| "center" \\| "end" \\| "stretch" | (none) | rarely needed — default stretch is usually right |
| justify | "start" \\| "center" \\| "end" \\| "between" \\| "around" | (none) | only matters when Stack has a fixed height |

---

## Inline — horizontal row

\`\`\`tsx
import { Inline } from "@/components/ui/inline";
// (Re-exported from "@/components/ui/stack" too, for back-compat.)

<Inline gap={2}>
  <Button>Save</Button>
  <Button variant="outline">Cancel</Button>
</Inline>

{/* Toolbar with item on each end */}
<Inline justify="between">
  <h2 className="text-xl font-semibold">Orders</h2>
  <Inline gap={2}>
    <Button variant="outline" size="sm"><Filter className="h-4 w-4 mr-2" />Filter</Button>
    <Button size="sm"><Plus className="h-4 w-4 mr-2" />New</Button>
  </Inline>
</Inline>
\`\`\`

**Props** — same as Stack, plus:

| prop  | values | default | notes |
|-------|--------|---------|-------|
| wrap  | boolean | false  | enable when the row holds many tags/badges that should wrap on small screens |
| align | (same as Stack) | "center" | Inline defaults to vertical centering — usually what you want |
| gap   | (same as Stack) | 2 | Inline defaults to a tighter gap than Stack |

---

## Grid — responsive multi-column

Use a **preset** for common layouts. Only fall back to manual cols/sm/md/lg
when no preset fits.

\`\`\`tsx
import { Grid } from "@/components/ui/grid";

{/* Stat cards across the top of a dashboard */}
<Grid preset="stats">
  <StatCard label="Revenue"  value="$12,480" />
  <StatCard label="Orders"   value="328"     />
  <StatCard label="Users"    value="1,204"   />
  <StatCard label="Refunds"  value="4"       />
</Grid>

{/* Marketing feature section */}
<Grid preset="features">
  <FeatureCard icon={Zap}    title="Fast"    desc="..." />
  <FeatureCard icon={Shield} title="Secure"  desc="..." />
  <FeatureCard icon={Heart}  title="Loved"   desc="..." />
</Grid>

{/* Manual composition when no preset fits */}
<Grid cols={1} sm={2} md={3} lg={4} gap={6}>
  {products.map(p => <ProductCard key={p.id} {...p} />)}
</Grid>
\`\`\`

**Presets**

| preset      | breakpoints (mobile -> desktop) | gap | use case                              |
|-------------|---------------------------------|-----|---------------------------------------|
| stats       | 1 -> 2 -> 4                     | 4   | row of KPI/stat cards                 |
| kpis        | 2 -> 4 -> 6                     | 3   | dense KPI tiles                       |
| dashboard   | 1 -> 2 -> 3                     | 6   | dashboard widgets                     |
| cards       | 1 -> 2 -> 3 -> 4                | 6   | product / feature card grid           |
| features    | 1 -> 2 -> 3                     | 8   | marketing feature section             |
| pricing     | 1 -> 3                          | 6   | pricing tiers                         |
| split       | 1 -> 2                          | 6   | two-column layout (main + sidebar)    |
| gallery     | 2 -> 3 -> 4                     | 3   | photo / media gallery                 |

**Manual props** (override or replace a preset):

- \`cols\`, \`sm\`, \`md\`, \`lg\` — only these column counts work: **1, 2, 3, 4, 6, 12**.
- \`gap\` — 0, 2, 3, 4, 6, 8, 10, 12.
- Any explicit prop overrides the preset (e.g. \`<Grid preset="cards" lg={3}>\`).

---

## Putting it together — full page template

Every page should follow this skeleton:

\`\`\`tsx
import { Container } from "@/components/ui/container";
import { Stack } from "@/components/ui/stack";
import { Inline } from "@/components/ui/inline";
import { Grid } from "@/components/ui/grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";

export function DashboardPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Page-wide section padding */}
      <section className="py-10">
        <Container size="xl">
          <Stack gap={8}>
            {/* Page header */}
            <Inline justify="between">
              <Stack gap={1}>
                <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
                <p className="text-muted-foreground">Overview of your store today.</p>
              </Stack>
              <Button><Plus className="h-4 w-4 mr-2" />New order</Button>
            </Inline>

            {/* Stat row */}
            <Grid preset="stats">
              <StatCard label="Revenue" value="$12,480" />
              <StatCard label="Orders"  value="328" />
              <StatCard label="Users"   value="1,204" />
              <StatCard label="Refunds" value="4" />
            </Grid>

            {/* Widgets */}
            <Grid preset="dashboard">
              <Card><CardHeader><CardTitle>Sales</CardTitle></CardHeader><CardContent>...</CardContent></Card>
              <Card><CardHeader><CardTitle>Top products</CardTitle></CardHeader><CardContent>...</CardContent></Card>
              <Card><CardHeader><CardTitle>Recent orders</CardTitle></CardHeader><CardContent>...</CardContent></Card>
            </Grid>
          </Stack>
        </Container>
      </section>
    </div>
  );
}
\`\`\`

---

## Recipes

### Auth screen (centered card)

\`\`\`tsx
<div className="min-h-screen bg-background grid place-items-center p-4">
  <Container size="sm">
    <Card>
      <CardHeader><CardTitle>Sign in</CardTitle></CardHeader>
      <CardContent>
        <Stack gap={4}>
          <Stack gap={2}><Label htmlFor="email">Email</Label><Input id="email" /></Stack>
          <Stack gap={2}><Label htmlFor="pw">Password</Label><Input id="pw" type="password" /></Stack>
          <Button className="w-full">Continue</Button>
        </Stack>
      </CardContent>
    </Card>
  </Container>
</div>
\`\`\`

### Settings list (label/description left, control right)

\`\`\`tsx
<Stack gap={0} className="divide-y divide-border">
  <Inline justify="between" className="py-4">
    <Stack gap={1}>
      <Label>Email notifications</Label>
      <p className="text-sm text-muted-foreground">Get notified about new comments.</p>
    </Stack>
    <Switch />
  </Inline>
  <Inline justify="between" className="py-4">
    <Stack gap={1}>
      <Label>Weekly digest</Label>
      <p className="text-sm text-muted-foreground">A summary every Monday.</p>
    </Stack>
    <Switch />
  </Inline>
</Stack>
\`\`\`

### Empty state

\`\`\`tsx
<Container size="md">
  <Stack gap={4} align="center" className="py-16 text-center">
    <div className="rounded-full bg-primary/10 p-4">
      <Inbox className="h-8 w-8 text-primary" />
    </div>
    <Stack gap={1} align="center">
      <h2 className="text-xl font-semibold">No orders yet</h2>
      <p className="text-muted-foreground max-w-sm">When customers place orders, they'll show up here.</p>
    </Stack>
    <Button>Create your first product</Button>
  </Stack>
</Container>
\`\`\`

---

## Anti-patterns — do NOT do these

| Bad                                                            | Good                                          |
|----------------------------------------------------------------|-----------------------------------------------|
| \`<div className="max-w-6xl mx-auto px-4">\`                     | \`<Container size="lg">\`                       |
| \`<div className="flex flex-col gap-6">\`                        | \`<Stack gap={6}>\`                             |
| \`<div className="flex items-center gap-2">\`                    | \`<Inline gap={2}>\`                            |
| \`<div className="flex justify-between items-center">\`          | \`<Inline justify="between">\`                  |
| \`<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">\` | \`<Grid preset="dashboard">\`         |
| \`<Container><Container>...</Container></Container>\` (nested)   | One Container per section, never nested        |
| \`<Grid cols={5}>\`                                              | Allowed cols are 1, 2, 3, 4, 6, 12 only        |
| Mixing raw Tailwind grid classes inside a \`<Grid>\` child       | Let Grid own column counts; child controls its own padding only |

---

## Quick reference (copy these snippets)

\`\`\`tsx
// Page shell
<div className="min-h-screen bg-background">
  <section className="py-10">
    <Container size="xl">
      <Stack gap={8}>{/* ... */}</Stack>
    </Container>
  </section>
</div>

// Header + actions
<Inline justify="between">
  <h1 className="text-2xl font-semibold tracking-tight">Title</h1>
  <Inline gap={2}><Button variant="outline">Cancel</Button><Button>Save</Button></Inline>
</Inline>

// Stats row
<Grid preset="stats">{/* 4 stat cards */}</Grid>

// Card grid
<Grid preset="cards">{/* product cards */}</Grid>

// Two-column with sidebar
<Grid preset="split">
  <main>...</main>
  <aside>...</aside>
</Grid>
\`\`\`

---

## Theming — automatic light / dark adaptation

\`Container\`, \`Stack\`, \`Inline\`, and \`Grid\` are **intentionally color-free** —
they apply only \`flex\`, \`grid\`, \`gap-*\`, \`items-*\`, \`justify-*\`, \`max-w-*\`,
and \`px-*\` utilities. They paint no background, border, or text colour of
their own. That is why they adapt to theme changes for free: theme switches
do not touch them at all — only the components placed inside them (Card,
Button, Input, …) re-render with new \`bg-background\` / \`text-foreground\` /
\`border-border\` token values from \`src/styles.css\`.

**Rules**

- Do NOT add \`bg-*\`, \`text-*\`, or \`border-*\` directly to a primitive — wrap
  the colored region in a \`<Card>\` or a semantic surface instead. This keeps
  primitives reusable (e.g. a \`<Stack>\` inside a Card and inside a Sheet
  should not both force a background).
- The page-level \`<div className="min-h-screen bg-background">\` shell IS the
  one place backgrounds belong — see the page template above.
- Any custom token you add (e.g. \`--surface-elevated\`) must be defined in
  both \`:root\` and \`.dark\` selectors of \`src/styles.css\` so it adapts.

---

## Tutorial — assemble a page in 4 steps

Build any page by composing the primitives top-down. Same recipe works for
landings, dashboards, settings, and detail screens.

### Step 1 — page shell + container

Start with the themed background and a centered container.

\`\`\`tsx
<div className="min-h-screen bg-background">
  <section className="py-10">
    <Container size="xl">
      {/* everything lives here */}
    </Container>
  </section>
</div>
\`\`\`

### Step 2 — vertical rhythm with Stack

Wrap the container's children in a \`<Stack>\` to get consistent vertical
spacing between major sections — never sprinkle \`mb-8\` on individual blocks.

\`\`\`tsx
<Container size="xl">
  <Stack gap={8}>
    {/* header */}
    {/* stats */}
    {/* widgets */}
  </Stack>
</Container>
\`\`\`

### Step 3 — header row with Inline

Page headers are almost always "title on the left, actions on the right".
That is \`<Inline justify="between">\`. If the right side has multiple buttons,
nest another \`<Inline gap={2}>\`.

\`\`\`tsx
<Inline justify="between">
  <Stack gap={1}>
    <h1 className="text-3xl font-semibold tracking-tight">Orders</h1>
    <p className="text-muted-foreground">Most recent first.</p>
  </Stack>
  <Inline gap={2}>
    <Button variant="outline">Export</Button>
    <Button><Plus className="h-4 w-4" />New order</Button>
  </Inline>
</Inline>
\`\`\`

### Step 4 — multi-column areas with Grid

Reach for a preset (\`stats\`, \`dashboard\`, \`cards\`, \`features\`, \`pricing\`,
\`split\`, \`gallery\`) before writing manual breakpoint props.

\`\`\`tsx
<Grid preset="stats">
  <KpiCard label="Revenue"  value="$48,294" delta={12.4} />
  <KpiCard label="Orders"   value="1,294"   delta={4.1} />
  <KpiCard label="Users"    value="8,212"   delta={-2.3} />
  <KpiCard label="Sessions" value="23,402"  delta={9.8} />
</Grid>

<Grid preset="dashboard">
  <Card>{/* chart */}</Card>
  <Card>{/* activity log */}</Card>
  <Card>{/* recent orders */}</Card>
</Grid>
\`\`\`

That is it — Container ⊃ Stack ⊃ (Inline | Grid) covers the entire page.

---

## Mental model — one sentence each

- **Container** = "center this and stop it from going edge-to-edge."
- **Stack** = "stack these vertically with even spacing."
- **Inline** = "put these on one row, vertically aligned."
- **Grid** = "put these into responsive columns."
`;


/**
 * Reference patterns. NOT user-visible routes. The AI is told these files
 * exist purely as a copy-from source for richer interactions (Dialog + Sheet +
 * Tabs + Table together). They live under src/components/examples/* so they
 * never accidentally collide with user feature components.
 *
 * The AI MUST NOT import these from App.tsx — they are read-only references.
 */
const EXAMPLE_DATA_TABLE_DIALOG = `import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * PATTERN: Table rows that open a Dialog for row-level edits.
 * - Single source of truth for selected row in local state.
 * - Dialog is controlled (open/onOpenChange) so it closes after save.
 * - Edits are applied immutably to the rows array.
 */

type Row = { id: string; name: string; email: string; role: "admin" | "member" };

const SEED: Row[] = [
  { id: "1", name: "Ada Lovelace", email: "ada@example.com", role: "admin" },
  { id: "2", name: "Linus Torvalds", email: "linus@example.com", role: "member" },
  { id: "3", name: "Grace Hopper", email: "grace@example.com", role: "admin" },
];

export function ExampleDataTableDialog() {
  const [rows, setRows] = React.useState<Row[]>(SEED);
  const [editing, setEditing] = React.useState<Row | null>(null);

  const save = (next: Row) => {
    setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)));
    setEditing(null);
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="text-muted-foreground">{r.email}</TableCell>
              <TableCell>
                <Badge variant={r.role === "admin" ? "default" : "secondary"}>{r.role}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Update the row and save your changes.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => editing && save(editing)}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
`;

const EXAMPLE_TABS_TABLE_DASHBOARD = `import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Stack } from "@/components/ui/stack";
import { Grid } from "@/components/ui/grid";

/**
 * PATTERN: Dashboard with Tabs switching between summary cards and a
 * detailed Table. Same dataset, two views — Tabs are the right primitive
 * (NOT separate routes) when the user needs quick view-toggling.
 */

const ORDERS = [
  { id: "1001", customer: "Acme Inc.", total: 1240, status: "paid" as const },
  { id: "1002", customer: "Globex", total: 89, status: "pending" as const },
  { id: "1003", customer: "Initech", total: 540, status: "paid" as const },
  { id: "1004", customer: "Umbrella", total: 320, status: "refunded" as const },
];

const STATUS_VARIANT: Record<(typeof ORDERS)[number]["status"], "default" | "secondary" | "destructive"> = {
  paid: "default",
  pending: "secondary",
  refunded: "destructive",
};

export function ExampleTabsTableDashboard() {
  const totalRevenue = ORDERS.filter((o) => o.status === "paid").reduce((s, o) => s + o.total, 0);
  const pending = ORDERS.filter((o) => o.status === "pending").length;
  const refunded = ORDERS.filter((o) => o.status === "refunded").length;

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="orders">Orders</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <Grid preset="stats">
          <Card>
            <CardHeader>
              <CardDescription>Revenue</CardDescription>
              <CardTitle className="text-3xl">{"$" + totalRevenue.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Pending</CardDescription>
              <CardTitle className="text-3xl">{pending}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Refunded</CardDescription>
              <CardTitle className="text-3xl">{refunded}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Total orders</CardDescription>
              <CardTitle className="text-3xl">{ORDERS.length}</CardTitle>
            </CardHeader>
          </Card>
        </Grid>
      </TabsContent>

      <TabsContent value="orders">
        <Card>
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <CardDescription>The latest activity across your store.</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ORDERS.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono">#{o.id}</TableCell>
                      <TableCell>{o.customer}</TableCell>
                      <TableCell className="text-right">{"$" + o.total}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[o.status]}>{o.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
`;

const EXAMPLE_SHEET_DETAIL_PANEL = `import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Stack } from "@/components/ui/stack";

/**
 * PATTERN: Master/detail using a side Sheet instead of navigating away.
 * Use a Sheet (not a Dialog) when the detail content is long-form,
 * scrollable, or the user might keep the table visible mentally.
 */

type Invoice = {
  id: string;
  client: string;
  amount: number;
  status: "draft" | "sent" | "paid";
  items: { label: string; qty: number; price: number }[];
};

const INVOICES: Invoice[] = [
  {
    id: "INV-001",
    client: "Acme Inc.",
    amount: 1240,
    status: "paid",
    items: [
      { label: "Design retainer", qty: 1, price: 1000 },
      { label: "Revisions", qty: 4, price: 60 },
    ],
  },
  {
    id: "INV-002",
    client: "Globex",
    amount: 540,
    status: "sent",
    items: [{ label: "Consulting", qty: 6, price: 90 }],
  },
];

export function ExampleSheetDetailPanel() {
  const [selected, setSelected] = React.useState<Invoice | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Client</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {INVOICES.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-mono">{inv.id}</TableCell>
              <TableCell>{inv.client}</TableCell>
              <TableCell className="text-right">{"$" + inv.amount}</TableCell>
              <TableCell>
                <Badge variant={inv.status === "paid" ? "default" : "secondary"}>{inv.status}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => setSelected(inv)}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected?.id}</SheetTitle>
            <SheetDescription>{selected?.client}</SheetDescription>
          </SheetHeader>
          {selected && (
            <Stack gap={4} className="py-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell>{it.label}</TableCell>
                      <TableCell className="text-right">{it.qty}</TableCell>
                      <TableCell className="text-right">{"$" + it.price}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold">{"$" + selected.amount}</span>
              </div>
            </Stack>
          )}
          <SheetFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
            <Button>Mark as paid</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
`;

const EXAMPLE_TABS_SHEET_SETTINGS = `import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Stack } from "@/components/ui/stack";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * PATTERN: Settings page where Tabs partition sections (Profile / Notifications)
 * and a Sheet hosts a focused destructive flow ("Delete account") so it doesn't
 * disrupt the surrounding page state.
 */

export function ExampleTabsSheetSettings() {
  const [name, setName] = React.useState("Ada Lovelace");
  const [emailNotif, setEmailNotif] = React.useState(true);
  const [pushNotif, setPushNotif] = React.useState(false);

  return (
    <Tabs defaultValue="profile">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="danger">Danger zone</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>How others see you on the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <div className="grid gap-2">
                <Label htmlFor="display-name">Display name</Label>
                <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button className="w-fit">Save</Button>
            </Stack>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="notifications">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Choose how you want to be reached.</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Email</Label>
                  <p className="text-sm text-muted-foreground">Weekly summaries and important alerts.</p>
                </div>
                <Switch checked={emailNotif} onCheckedChange={setEmailNotif} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Push</Label>
                  <p className="text-sm text-muted-foreground">Real-time mentions and replies.</p>
                </div>
                <Switch checked={pushNotif} onCheckedChange={setPushNotif} />
              </div>
            </Stack>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="danger">
        <Card>
          <CardHeader>
            <CardTitle>Delete account</CardTitle>
            <CardDescription>This action is permanent and cannot be undone.</CardDescription>
          </CardHeader>
          <CardContent>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="destructive">Delete account</Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>Delete your account?</SheetTitle>
                  <SheetDescription>
                    Type your name to confirm. All your data will be removed.
                  </SheetDescription>
                </SheetHeader>
                <Stack gap={3} className="py-4">
                  <Label htmlFor="confirm">Confirm name</Label>
                  <Input id="confirm" placeholder={name} />
                </Stack>
                <SheetFooter>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="destructive">Permanently delete</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
`;

// ============================================================
// PHASE 3 KIT EXPANSION — Calendar, DatePicker, Combobox, Form,
// Drawer, Chart. All zero-dep, hand-rolled to match the rest of
// the kit (no cmdk / vaul / recharts / react-day-picker /
// react-hook-form additions).
//
// NOTE: Command palette intentionally omitted — generated apps
// are consumer-facing, not IDE-style tools, so a Cmd+K palette
// adds bundle weight and confusion for end users. If a user ever
// asks for one specifically, build it ad-hoc on top of <Dialog>
// + <Input> rather than re-introducing a primitive here.
// ============================================================

const CALENDAR = `import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal month-grid Calendar. No third-party deps.
 *   <Calendar mode="single" selected={date} onSelect={setDate} />
 *   <Calendar mode="range" selected={{from, to}} onSelect={setRange} />
 */
type SingleProps = {
  mode?: "single";
  selected?: Date;
  onSelect?: (d: Date | undefined) => void;
};
type RangeProps = {
  mode: "range";
  selected?: { from?: Date; to?: Date };
  onSelect?: (r: { from?: Date; to?: Date }) => void;
};
type CalendarProps = (SingleProps | RangeProps) & {
  className?: string;
  disabled?: (d: Date) => boolean;
  initialMonth?: Date;
};

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function isSameDay(a?: Date, b?: Date) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isInRange(d: Date, from?: Date, to?: Date) {
  if (!from || !to) return false;
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}

export function Calendar(props: CalendarProps) {
  const { className, disabled, initialMonth } = props;
  const initial = initialMonth ?? (props.mode === "range" ? props.selected?.from : (props as SingleProps).selected) ?? new Date();
  const [view, setView] = React.useState(startOfMonth(initial));

  const month = view.getMonth();
  const year = view.getFullYear();
  const firstWeekday = view.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<Date | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = view.toLocaleString("default", { month: "long", year: "numeric" });

  const handleSelect = (d: Date) => {
    if (disabled?.(d)) return;
    if (props.mode === "range") {
      const cur = props.selected;
      if (!cur?.from || (cur.from && cur.to)) {
        props.onSelect?.({ from: d, to: undefined });
      } else if (d.getTime() < cur.from.getTime()) {
        props.onSelect?.({ from: d, to: cur.from });
      } else {
        props.onSelect?.({ from: cur.from, to: d });
      }
    } else {
      props.onSelect?.(d);
    }
  };

  return (
    <div className={cn("p-3 pointer-events-auto", className)}>
      <div className="flex items-center justify-between pb-2">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-medium">{monthLabel}</div>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {DAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const isDisabled = disabled?.(d) ?? false;
          let isSelected = false;
          let isInBetween = false;
          if (props.mode === "range") {
            isSelected = isSameDay(d, props.selected?.from) || isSameDay(d, props.selected?.to);
            isInBetween = isInRange(d, props.selected?.from, props.selected?.to) && !isSelected;
          } else {
            isSelected = isSameDay(d, (props as SingleProps).selected);
          }
          const isToday = isSameDay(d, new Date());
          return (
            <button
              key={i}
              type="button"
              disabled={isDisabled}
              onClick={() => handleSelect(d)}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm",
                "hover:bg-accent hover:text-accent-foreground",
                isToday && !isSelected && "border border-border",
                isInBetween && "bg-accent/50",
                isSelected && "bg-primary text-primary-foreground hover:bg-primary",
                isDisabled && "opacity-40 pointer-events-none",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
`;

const DATE_PICKER = `import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Drop-in date picker. Use whenever you need a single calendar field —
 * NEVER hand-roll a custom date input.
 *   <DatePicker value={date} onChange={setDate} placeholder="Pick a date" />
 */
function format(d: Date) {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
}: {
  value?: Date;
  onChange?: (d: Date | undefined) => void;
  placeholder?: string;
  disabled?: (d: Date) => boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-[240px] justify-start text-left font-normal", !value && "text-muted-foreground", className)}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => { onChange?.(d); setOpen(false); }}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
`;

const COMBOBOX = `import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Searchable single-select. Use whenever the user picks one option from a
 * long list (5+) — NEVER hand-roll a styled <select> for that case.
 *   <Combobox
 *     options={[{label:"Apple",value:"apple"}, ...]}
 *     value={picked}
 *     onChange={setPicked}
 *     placeholder="Pick a fruit"
 *   />
 */
export type ComboboxOption = { label: string; value: string };

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results.",
  className,
}: {
  options: ComboboxOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const current = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  React.useEffect(() => { if (!open) setQuery(""); }, [open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-[240px] justify-between font-normal", !current && "text-muted-foreground", className)}
        >
          {current ? current.label : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 border-0 px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                onClick={() => { onChange?.(opt.value); setOpen(false); }}
                className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <Check className={cn("mr-2 h-4 w-4", value === opt.value ? "opacity-100" : "opacity-0")} />
                {opt.label}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
`;

const FORM = `import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Tiny form helper. NOT a react-hook-form clone — a thin wrapper that
 * gives you typed values, per-field errors, and submit handling without
 * any new dependencies.
 *
 *   const form = useForm({
 *     defaults: { email: "", password: "" },
 *     validate: (v) => ({
 *       email: !v.email.includes("@") ? "Invalid email" : undefined,
 *       password: v.password.length < 8 ? "Min 8 chars" : undefined,
 *     }),
 *     onSubmit: async (v) => { await api.signIn(v); },
 *   });
 *
 *   <Form onSubmit={form.handleSubmit}>
 *     <FormField name="email" label="Email" error={form.errors.email}>
 *       <Input {...form.register("email")} />
 *     </FormField>
 *     <Button type="submit" disabled={form.submitting}>Sign in</Button>
 *   </Form>
 *
 * For richer needs (async validation, arrays), graduate to react-hook-form.
 */
export type FormErrors<T> = { [K in keyof T]?: string };

export function useForm<T extends Record<string, unknown>>(opts: {
  defaults: T;
  validate?: (values: T) => FormErrors<T>;
  onSubmit: (values: T) => void | Promise<void>;
}) {
  const [values, setValues] = React.useState<T>(opts.defaults);
  const [errors, setErrors] = React.useState<FormErrors<T>>({});
  const [touched, setTouched] = React.useState<Partial<Record<keyof T, boolean>>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const setValue = React.useCallback(<K extends keyof T>(name: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const register = React.useCallback(<K extends keyof T & string>(name: K) => ({
    name,
    value: values[name] as unknown as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setValue(name, e.target.value as unknown as T[K]);
    },
    onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
  }), [values, setValue]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs = opts.validate?.(values) ?? {};
    setErrors(errs);
    const allTouched = Object.keys(values).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched as Partial<Record<keyof T, boolean>>);
    if (Object.values(errs).some((v) => v)) return;
    setSubmitting(true);
    try {
      await opts.onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = (next?: T) => { setValues(next ?? opts.defaults); setErrors({}); setTouched({}); };

  return { values, errors, touched, submitting, setValue, register, handleSubmit, reset };
}

export function Form({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form className={cn("space-y-4", className)} {...props} />;
}

export function FormField({
  name,
  label,
  description,
  error,
  className,
  children,
}: {
  name: string;
  label?: string;
  description?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label htmlFor={name}>{label}</Label>}
      {children}
      {description && !error && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
`;

const DRAWER = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom-anchored drawer (mobile-first). Sibling to <Sheet>. Use this
 * for mobile detail panels and action sheets where you want a draggable
 * handle and rounded top corners.
 *
 *   <Drawer open={open} onOpenChange={setOpen}>
 *     <DrawerContent>
 *       <DrawerHeader>
 *         <DrawerTitle>Filters</DrawerTitle>
 *         <DrawerDescription>Refine the list below.</DrawerDescription>
 *       </DrawerHeader>
 *       <div className="px-4 pb-4">...</div>
 *       <DrawerFooter>
 *         <Button>Apply</Button>
 *       </DrawerFooter>
 *     </DrawerContent>
 *   </Drawer>
 */
type Ctx = { open: boolean; setOpen: (v: boolean) => void };
const DrawerContext = React.createContext<Ctx | null>(null);

export function Drawer({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const open = controlled ?? internal;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setInternal(v);
    onOpenChange?.(v);
  };
  return <DrawerContext.Provider value={{ open, setOpen }}>{children}</DrawerContext.Provider>;
}

export function DrawerTrigger({ asChild: _asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(DrawerContext);
  if (!ctx) throw new Error("DrawerTrigger must be inside Drawer");
  return React.cloneElement(children, { onClick: () => ctx.setOpen(true) } as React.HTMLAttributes<HTMLElement>);
}

export function DrawerClose({ asChild: _asChild, children }: { asChild?: boolean; children: React.ReactElement }) {
  const ctx = React.useContext(DrawerContext);
  if (!ctx) throw new Error("DrawerClose must be inside Drawer");
  return React.cloneElement(children, { onClick: () => ctx.setOpen(false) } as React.HTMLAttributes<HTMLElement>);
}

export function DrawerContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(DrawerContext);
  React.useEffect(() => {
    if (!ctx?.open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") ctx.setOpen(false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [ctx]);
  if (!ctx?.open) return null;
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => ctx.setOpen(false)} />
      <div
        role="dialog"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[85vh] flex-col rounded-t-[12px] border bg-background",
          "animate-in slide-in-from-bottom",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
        {children}
      </div>
    </>
  );
}

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)} {...props} />;
}
export function DrawerTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)} {...props} />;
}
export function DrawerDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
}
`;

const CHART = `import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight pure-SVG charts. Zero dependencies. For cases the kit
 * doesn't cover (treemaps, radial), graduate to recharts manually.
 *
 *   <LineChart data={[{x:"Mon",y:120}, ...]} className="h-48" />
 *   <AreaChart data={[...]} />
 *   <BarChart data={[...]} />
 *
 * All three accept the same props. Colors come from semantic tokens
 * via CSS variables on the wrapping ChartContainer (--chart-1 etc.).
 */
export type ChartPoint = { x: string | number; y: number };
export type ChartProps = React.HTMLAttributes<HTMLDivElement> & {
  data: ChartPoint[];
  /** 1..5 — selects the semantic chart color token. */
  color?: 1 | 2 | 3 | 4 | 5;
  /** Show x-axis labels. */
  xAxis?: boolean;
  /** Show y-axis ticks. */
  yAxis?: boolean;
};

const DEFAULT_COLORS: Record<number, string> = {
  1: "var(--primary)",
  2: "oklch(0.65 0.18 200)",
  3: "oklch(0.6 0.2 30)",
  4: "oklch(0.65 0.15 140)",
  5: "oklch(0.6 0.18 320)",
};

function useDimensions(data: ChartPoint[]) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const min = Math.min(0, ...data.map((d) => d.y));
  return { max, min };
}

export function ChartContainer({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative h-64 w-full", className)} {...props}>
      {children}
    </div>
  );
}

export function LineChart({ data, color = 1, xAxis = true, className, ...props }: ChartProps) {
  const { max, min } = useDimensions(data);
  const stroke = DEFAULT_COLORS[color];
  const w = 100;
  const h = 100;
  const pad = 4;
  const points = data.map((d, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
    const y = h - pad - ((d.y - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => (i === 0 ? \`M\${x},\${y}\` : \`L\${x},\${y}\`)).join(" ");
  return (
    <ChartContainer className={className} {...props}>
      <svg viewBox={\`0 0 \${w} \${h}\`} preserveAspectRatio="none" className="h-full w-full">
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {xAxis && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          {data.map((d, i) => <span key={i}>{d.x}</span>)}
        </div>
      )}
    </ChartContainer>
  );
}

export function AreaChart({ data, color = 1, xAxis = true, className, ...props }: ChartProps) {
  const { max, min } = useDimensions(data);
  const stroke = DEFAULT_COLORS[color];
  const w = 100;
  const h = 100;
  const pad = 4;
  const points = data.map((d, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1);
    const y = h - pad - ((d.y - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y] as const;
  });
  const linePath = points.map(([x, y], i) => (i === 0 ? \`M\${x},\${y}\` : \`L\${x},\${y}\`)).join(" ");
  const areaPath = \`\${linePath} L\${points[points.length - 1][0]},\${h - pad} L\${points[0][0]},\${h - pad} Z\`;
  const id = React.useId();
  return (
    <ChartContainer className={className} {...props}>
      <svg viewBox={\`0 0 \${w} \${h}\`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={\`url(#\${id})\`} />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {xAxis && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          {data.map((d, i) => <span key={i}>{d.x}</span>)}
        </div>
      )}
    </ChartContainer>
  );
}

export function BarChart({ data, color = 1, xAxis = true, className, ...props }: ChartProps) {
  const { max } = useDimensions(data);
  const fill = DEFAULT_COLORS[color];
  const w = 100;
  const h = 100;
  const pad = 4;
  const slot = (w - pad * 2) / Math.max(1, data.length);
  const barW = Math.max(1, slot * 0.65);
  return (
    <ChartContainer className={className} {...props}>
      <svg viewBox={\`0 0 \${w} \${h}\`} preserveAspectRatio="none" className="h-full w-full">
        {data.map((d, i) => {
          const x = pad + i * slot + (slot - barW) / 2;
          const barH = ((d.y / (max || 1)) * (h - pad * 2));
          const y = h - pad - barH;
          return <rect key={i} x={x} y={y} width={barW} height={Math.max(0, barH)} rx={0.5} fill={fill} />;
        })}
      </svg>
      {xAxis && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          {data.map((d, i) => <span key={i}>{d.x}</span>)}
        </div>
      )}
    </ChartContainer>
  );
}
`;

/**
 * Files that are ALWAYS injected/overwritten on initial scaffold. The AI is
 * told these exist and not to emit them; if it does, we replace them anyway
 * to keep the kit canonical.
 */
export const KIT_FILES: KitFile[] = [
  { path: "vite.config.ts", content: VITE_CONFIG, overwrite: true },
  { path: "petal-source-plugin.mjs", content: PETAL_SOURCE_PLUGIN, overwrite: true },
  { path: "tsconfig.json", content: TSCONFIG, overwrite: true },
  { path: "src/styles.css", content: STYLES_CSS, overwrite: false /* AI may extend tokens */ },
  { path: "src/lib/utils.ts", content: UTILS_TS, overwrite: true },
  { path: "src/components/ui/button.tsx", content: BUTTON, overwrite: true },
  { path: "src/components/ui/card.tsx", content: CARD, overwrite: true },
  { path: "src/components/ui/input.tsx", content: INPUT, overwrite: true },
  { path: "src/components/ui/input-otp.tsx", content: INPUT_OTP, overwrite: true },
  { path: "src/components/ui/pagination.tsx", content: PAGINATION, overwrite: true },
  { path: "src/components/ui/alert-dialog.tsx", content: ALERT_DIALOG, overwrite: true },
  { path: "src/components/ui/textarea.tsx", content: TEXTAREA, overwrite: true },
  { path: "src/components/ui/label.tsx", content: LABEL, overwrite: true },
  { path: "src/components/ui/badge.tsx", content: BADGE, overwrite: true },
  { path: "src/components/ui/separator.tsx", content: SEPARATOR, overwrite: true },
  { path: "src/components/ui/avatar.tsx", content: AVATAR, overwrite: true },
  { path: "src/components/ui/alert.tsx", content: ALERT, overwrite: true },
  { path: "src/components/ui/skeleton.tsx", content: SKELETON, overwrite: true },
  { path: "src/components/ui/switch.tsx", content: SWITCH, overwrite: true },
  { path: "src/components/ui/tabs.tsx", content: TABS, overwrite: true },
  { path: "src/components/ui/dialog.tsx", content: DIALOG, overwrite: true },
  { path: "src/components/ui/select.tsx", content: SELECT, overwrite: true },
  { path: "src/components/ui/checkbox.tsx", content: CHECKBOX, overwrite: true },
  { path: "src/components/ui/radio-group.tsx", content: RADIO_GROUP, overwrite: true },
  { path: "src/components/ui/slider.tsx", content: SLIDER, overwrite: true },
  { path: "src/components/ui/progress.tsx", content: PROGRESS, overwrite: true },
  { path: "src/components/ui/tooltip.tsx", content: TOOLTIP, overwrite: true },
  { path: "src/components/ui/popover.tsx", content: POPOVER, overwrite: true },
  { path: "src/components/ui/dropdown-menu.tsx", content: DROPDOWN_MENU, overwrite: true },
  { path: "src/components/ui/accordion.tsx", content: ACCORDION, overwrite: true },
  { path: "src/components/ui/scroll-area.tsx", content: SCROLL_AREA, overwrite: true },
  { path: "src/components/ui/table.tsx", content: TABLE, overwrite: true },
  { path: "src/components/ui/sheet.tsx", content: SHEET, overwrite: true },
  { path: "src/components/ui/toast.tsx", content: TOAST, overwrite: true },
  { path: "src/components/ui/theme-provider.tsx", content: THEME_PROVIDER, overwrite: true },
  { path: "src/components/ui/theme-toggle.tsx", content: THEME_TOGGLE, overwrite: true },
  { path: "src/components/ui/container.tsx", content: CONTAINER, overwrite: true },
  { path: "src/components/ui/stack.tsx", content: STACK, overwrite: true },
  { path: "src/components/ui/inline.tsx", content: INLINE, overwrite: true },
  { path: "src/components/ui/grid.tsx", content: GRID, overwrite: true },
  // Phase 3 kit expansion — Calendar, DatePicker, Combobox, Form, Drawer, Chart.
  // (Command palette intentionally omitted — see scaffold-kit note above.)
  { path: "src/components/ui/calendar.tsx", content: CALENDAR, overwrite: true },
  { path: "src/components/ui/date-picker.tsx", content: DATE_PICKER, overwrite: true },
  { path: "src/components/ui/combobox.tsx", content: COMBOBOX, overwrite: true },
  { path: "src/components/ui/form.tsx", content: FORM, overwrite: true },
  { path: "src/components/ui/drawer.tsx", content: DRAWER, overwrite: true },
  { path: "src/components/ui/chart.tsx", content: CHART, overwrite: true },
  // Phase 5 — multi-page routing (re-exports react-router-dom).
  { path: "src/components/ui/router.tsx", content: ROUTER, overwrite: true },
  // Reference patterns — read-only examples for the AI to copy from.
  // NOT imported by App.tsx unless the user asks for that exact pattern.
  {
    path: "src/components/examples/LAYOUT.md",
    content: LAYOUT_DOCS,
    overwrite: true,
  },
  {
    path: "src/components/examples/data-table-dialog.tsx",
    content: EXAMPLE_DATA_TABLE_DIALOG,
    overwrite: true,
  },
  {
    path: "src/components/examples/tabs-table-dashboard.tsx",
    content: EXAMPLE_TABS_TABLE_DASHBOARD,
    overwrite: true,
  },
  {
    path: "src/components/examples/sheet-detail-panel.tsx",
    content: EXAMPLE_SHEET_DETAIL_PANEL,
    overwrite: true,
  },
  {
    path: "src/components/examples/tabs-sheet-settings.tsx",
    content: EXAMPLE_TABS_SHEET_SETTINGS,
    overwrite: true,
  },
  // Curated copy-from pack: ~24 reference blocks covering auth, dashboard,
  // pricing, hero, forms, and tables. Lives in examples-pack.ts to keep this
  // file from getting unwieldy.
  ...EXAMPLES_PACK,
  // Volume 2: domain references for the 500-system expansion (kanban,
  // mobile shells, telehealth-demo, music-demo, directory, job board, IoT,
  // education, AI productivity, civic/donation, calendar/booking,
  // legal-demo, ticketing, POS, CRM, helpdesk, analytics, community,
  // portfolio).
  ...EXAMPLES_PACK_2,
  // Phase-1 expansion: new atoms (Marquee/Stat/EmptyState/Section/etc.) +
  // composed section blocks (Hero/Features variants) so generated landing
  // pages stop converging on the same centered-hero + 3-card layout.
  // Defined in a separate module so this file stays reviewable.
  ...KIT_BLOCK_FILES,
  // Phase-2 expansion: testimonials/pricing/FAQ/CTA/footer/nav/logos/stats
  // section variants + page-assembly examples (saas/editorial/ecommerce/
  // agency/app-shell/blog) showing the model how to compose full pages.
  ...KIT_BLOCK_FILES_2,
  // Phase-3 expansion (workstream B): data-display tiles (StatCard/KpiGrid/ComparisonTable/PricingTable/
  // ActivityFeed), form blocks (MultiStepWizard/FileUploadDropzone/EmptyStateCta),
  // dashboard shell (SidebarShell/SectionHeader/FilterBar), and commerce
  // (ProductCard/CartLineItem/CheckoutSummary). Defined separately to keep
  // diffs reviewable.
  ...KIT_BLOCK_FILES_3,
  // Phase-4 expansion: domain section blocks for the Step-2 templates —
  // commerce/booking (ServiceCard, MenuSection, BookingForm), content
  // (ArticleCard, AuthorCard, EpisodeCard, AudioPlayer), community
  // (ThreadCard, ReplyList, ComposeSheet), AI (ChatStream, MessageBubble,
  // PromptCard), mobile (MobileNav, FeedCard, ProfileHeader, LinkButton,
  // SocialRow), education (CourseCard, LessonPlayer), fintech-demo
  // (PriceTicker, DemoBanner), placeholders (Map/SeatMap), and aesthetics
  // (Gallery/Heatmap/CategoryGrid).
  ...KIT_BLOCK_FILES_4,
  // Mobile-feel primitives: SafeArea/MobileHeader/BottomTabBar/PullToRefresh
  // + MobileScreen wrapper + ExampleMobileApp shell. Use when the user asks
  // for a native iOS/Android app (Petal ships as Capacitor under the hood).
  ...KIT_BLOCK_FILES_MOBILE,
  // Phase 10 — Motion baseline. framer-motion primitives every app can compose:
  // FadeIn / SlideUp / Stagger / Reveal / Magnetic / Tilt / Parallax /
  // SplitText / CountUp / WordRotate / BlurFade. Import from "@/components/motion".
  ...KIT_MOTION_FILES,
  // Phase 11 — Marketing FX layer. MagicUI/Aceternity-style effects:
  // GridPattern/DotPattern/RetroGrid/FlickeringGrid/AnimatedGridPattern/Ripple/
  // NoiseTexture/LightRays/MeshGradient/Meteors/Particles/Sparkles, AuroraText/
  // GradientText/ShinyText, MagicCard/BorderBeam/GlowCard/BentoGrid+BentoCard/
  // Marquee/InfiniteMovingCards/OrbitingCircles/HeroParallax/AnimatedBeam,
  // ShimmerButton/RainbowButton/ShinyButton. Import from "@/components/fx".
  ...KIT_FX_FILES,
  // Phase 12 — Missing shadcn primitives. 18 components mirroring shadcn's
  // API: Breadcrumb, Collapsible, HoverCard, Toggle + ToggleGroup, AspectRatio,
  // Spinner, ContextMenu, Menubar, NavigationMenu, Empty, Field, InputGroup,
  // Carousel (Embla), Command (cmdk), Resizable (react-resizable-panels),
  // DataTable (TanStack Table), Sidebar (full system w/ useSidebar +
  // collapsible="icon" + mobile sheet swap).
  ...KIT_SHADCN_FILES,
  // Phase 13 — Data + state defaults. TanStack Query client + provider,
  // Zustand example store, nuqs URL-state hook re-export, and an AppProviders
  // wrapper that composes them with the sonner Toaster. Plus a DATA_PATTERNS
  // doc the AI copies from instead of inventing useEffect+fetch.
  ...KIT_DATA_FILES,
  // Phase 14 — Typography reference doc (FONTS.md). The actual styling
  // tokens (fluid type scale + Fontsource @imports + font tokens) live in
  // STYLES_CSS above. This is the "how to swap fonts per theme" guide.
  ...KIT_TYPOGRAPHY_FILES,
  // Phase 15 — Content & code surfaces. Shiki-highlighted code blocks,
  // react-markdown + remark-gfm renderer, and a TipTap WYSIWYG editor.
  // Heavy deps (shiki, @tiptap/*, react-markdown) are on-demand only via
  // known-packages.ts — not added to REQUIRED_DEPS.
  ...KIT_CONTENT_FILES,
  // Phase 16 — Awwwards layer (opt-in). R3F + drei scenes (Scene/FloatingMesh/
  // HeroSphere/SplineEmbed), Lenis smooth-scroll provider, GSAP ScrollTrigger
  // hooks (useScrollScene/useHorizontalScroll), canvas-confetti helpers,
  // and a View Transitions API wrapper. All deps on-demand only.
  ...KIT_AWWWARDS_FILES,
  // Phase 17 — A11y + image quality. ThumbhashImage placeholder, react-aria
  // helper re-exports for hand-rolled widgets, and a dev-only useAxe hook.
  // All deps (thumbhash, react-aria, @axe-core/react) are on-demand only.
  ...KIT_A11Y_FILES,
];

/**
 * Walk every scaffold file and verify that every `@/...` import resolves
 * against another scaffold file. Catches the class of bug where an example
 * file imports a UI primitive that the kit forgot to ship (real example:
 * examples-pack referenced @/components/ui/input-otp but the kit didn't
 * include it, breaking every build that copied the auth-otp-card block).
 *
 * Throws a clear error at module load if anything is missing — fail fast
 * during deploy is much better than a silent build failure on the user's
 * side. Cost: ~10ms once per Worker isolate.
 */
function verifyScaffoldIntegrity(): void {
  const paths = new Set(KIT_FILES.map((k) => k.path));
  const importRe = /from\s+["']@\/([^"']+)["']/g;
  const candidates = (base: string) => [
    `src/${base}`,
    `src/${base}.tsx`,
    `src/${base}.ts`,
    `src/${base}.jsx`,
    `src/${base}.js`,
    `src/${base}/index.tsx`,
    `src/${base}/index.ts`,
  ];
  const failures: string[] = [];
  for (const k of KIT_FILES) {
    if (!/\.(tsx?|jsx?)$/.test(k.path)) continue;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(k.content))) {
      const spec = m[1];
      // Backend kit imports are injected separately and only resolve when a
      // backend is connected — skip them here.
      if (spec.startsWith("integrations/backend/")) continue;
      const ok = candidates(spec).some((c) => paths.has(c));
      if (!ok) failures.push(`${k.path} imports @/${spec} (not shipped by scaffold)`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `[scaffold-kit] integrity check failed:\n - ${failures.join("\n - ")}\n` +
        `Either add the missing primitive to the kit or remove the example.`,
    );
  }
}

verifyScaffoldIntegrity();


/**
 * Required deps the kit pulls in. We post-process the AI's package.json to
 * guarantee they're present at the right caret ranges.
 */
const REQUIRED_DEPS: Record<string, string> = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  clsx: "^2.1.1",
  "tailwind-merge": "^2.5.4",
  "class-variance-authority": "^0.7.1",
  "lucide-react": "^0.460.0",
  "@radix-ui/react-slot": "^1.1.0",
  // Required by the scaffolded shadcn-compatible Select. Without this,
  // every CRUD app the LLM scaffolds breaks the moment it uses a dropdown.
  "@radix-ui/react-select": "^2.1.2",
  sonner: "^1.7.0",
  "react-router-dom": "^6.28.0",
  // Phase 13 — data + state defaults, always installed so the AppProviders
  // wrapper and the @/hooks/use-query-state shim compile on first build.
  "@tanstack/react-query": "^5.59.0",
  "@tanstack/react-table": "^8.20.5",
  zustand: "^5.0.0",
  nuqs: "^2.2.3",
  // Phase 14 — self-hosted variable fonts (no Google Fonts CDN hop, no CLS).
  // Imported by src/styles.css. Additional Fontsource Variable packages
  // (instrument-serif, cormorant, space-grotesk, bricolage-grotesque, etc.)
  // are listed in known-packages.ts and can be `@import`-ed per theme.
  "@fontsource-variable/inter": "^5.1.0",
  "@fontsource-variable/jetbrains-mono": "^5.1.0",
};

const REQUIRED_DEV_DEPS: Record<string, string> = {
  vite: "^5.4.10",
  "@vitejs/plugin-react": "^4.3.3",
  typescript: "^5.6.3",
  "@types/react": "^18.3.12",
  "@types/react-dom": "^18.3.1",
  tailwindcss: "^4.0.0",
  "@tailwindcss/vite": "^4.0.0",
};

/** Merge AI-emitted package.json with our required deps. */
function mergePackageJson(
  aiContent: string | undefined,
  extraDeps: Record<string, string> = {},
): string {
  let pkg: Record<string, unknown> = {};
  if (aiContent) {
    try {
      pkg = JSON.parse(aiContent);
    } catch {
      pkg = {};
    }
  }
  pkg.name = pkg.name ?? "petal-app";
  pkg.private = true;
  pkg.type = "module";
  pkg.scripts = {
    ...((pkg.scripts as Record<string, string>) ?? {}),
    dev: "vite --host 0.0.0.0 --port 5173",
    build: "vite build",
  };
  const aiDeps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
  const aiDevDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};
  // The model often invents semver ranges that no published version satisfies
  // (e.g. `react-use-wake-lock@^1.0.3` when only 1.0.1 exists), which kills
  // `npm install` with ETARGET. Force every AI-emitted version to `*` so npm
  // resolves whatever the registry actually has. Our REQUIRED_* maps below
  // override pins for any package the scaffold actually controls.
  const safeAiDeps: Record<string, string> = {};
  for (const k of Object.keys(aiDeps)) safeAiDeps[k] = "*";
  const safeAiDevDeps: Record<string, string> = {};
  for (const k of Object.keys(aiDevDeps)) safeAiDevDeps[k] = "*";
  pkg.dependencies = { ...safeAiDeps, ...REQUIRED_DEPS, ...extraDeps };
  pkg.devDependencies = { ...safeAiDevDeps, ...REQUIRED_DEV_DEPS };
  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * Inject the kit into the AI-emitted file list. Called only for INITIAL
 * generations (write_project), not patches.
 *
 * When `opts.backend` is provided, also merge in the backend kit
 * (pre-configured client, auth provider, storage helpers) so the AI can
 * import from `@/integrations/backend/*` without setting anything up.
 */
export function applyScaffoldKit(
  aiFiles: ProjectFile[],
  opts?: { backend?: { url: string; anonKey: string } },
): ProjectFile[] {
  const map = new Map<string, string>();
  for (const f of aiFiles) map.set(f.path, f.content);

  for (const kit of KIT_FILES) {
    if (kit.overwrite || !map.has(kit.path)) {
      map.set(kit.path, kit.content);
    }
  }

  // Backend kit + backend-only auth blocks: only injected when a backend is
  // connected to the project. All entries overwrite — these files are
  // protected and the AI must not own them.
  let extraDeps: Record<string, string> = {};
  if (opts?.backend) {
    for (const f of backendKit(opts.backend)) {
      map.set(f.path, f.content);
    }
    for (const f of BACKEND_KIT_BLOCK_FILES_3) {
      map.set(f.path, f.content);
    }
    extraDeps = BACKEND_DEPS;
  }

  // Always fix package.json (merge deps + any backend deps).
  map.set("package.json", mergePackageJson(map.get("package.json"), extraDeps));

  return Array.from(map, ([path, content]) => ({ path, content }));
}
