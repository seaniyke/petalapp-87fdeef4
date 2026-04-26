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

type KitFile = ProjectFile & { overwrite: boolean };

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

const STYLES_CSS = `@import "tailwindcss";

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
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
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
  background: var(--color-background);
  color: var(--color-foreground);
  -webkit-font-smoothing: antialiased;
}
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
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: { label: string; value: string }[];
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full appearance-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
    </div>
  )
);
Select.displayName = "Select";
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

/** Horizontal flex row. Use for inline groups (toolbars, button rows, badges). */
export const Inline = React.forwardRef<HTMLDivElement, StackProps & { wrap?: boolean }>(
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

/**
 * Files that are ALWAYS injected/overwritten on initial scaffold. The AI is
 * told these exist and not to emit them; if it does, we replace them anyway
 * to keep the kit canonical.
 */
const KIT: KitFile[] = [
  { path: "vite.config.ts", content: VITE_CONFIG, overwrite: true },
  { path: "tsconfig.json", content: TSCONFIG, overwrite: true },
  { path: "src/styles.css", content: STYLES_CSS, overwrite: false /* AI may extend tokens */ },
  { path: "src/lib/utils.ts", content: UTILS_TS, overwrite: true },
  { path: "src/components/ui/button.tsx", content: BUTTON, overwrite: true },
  { path: "src/components/ui/card.tsx", content: CARD, overwrite: true },
  { path: "src/components/ui/input.tsx", content: INPUT, overwrite: true },
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
  { path: "src/components/ui/grid.tsx", content: GRID, overwrite: true },
  // Reference patterns — read-only examples for the AI to copy from.
  // NOT imported by App.tsx unless the user asks for that exact pattern.
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
];

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
  sonner: "^1.7.0",
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
function mergePackageJson(aiContent: string | undefined): string {
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
  pkg.dependencies = { ...aiDeps, ...REQUIRED_DEPS };
  pkg.devDependencies = { ...aiDevDeps, ...REQUIRED_DEV_DEPS };
  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * Inject the kit into the AI-emitted file list. Called only for INITIAL
 * generations (write_project), not patches.
 */
export function applyScaffoldKit(aiFiles: ProjectFile[]): ProjectFile[] {
  const map = new Map<string, string>();
  for (const f of aiFiles) map.set(f.path, f.content);

  for (const kit of KIT) {
    if (kit.overwrite || !map.has(kit.path)) {
      map.set(kit.path, kit.content);
    }
  }

  // Always fix package.json (merge deps).
  map.set("package.json", mergePackageJson(map.get("package.json")));

  return Array.from(map, ([path, content]) => ({ path, content }));
}
