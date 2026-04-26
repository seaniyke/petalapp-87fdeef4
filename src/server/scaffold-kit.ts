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

@theme {
  --color-background: oklch(0.99 0.005 90);
  --color-foreground: oklch(0.18 0.02 280);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.18 0.02 280);
  --color-primary: oklch(0.55 0.18 280);
  --color-primary-foreground: oklch(0.99 0.005 90);
  --color-secondary: oklch(0.96 0.01 280);
  --color-secondary-foreground: oklch(0.22 0.03 280);
  --color-muted: oklch(0.96 0.01 280);
  --color-muted-foreground: oklch(0.5 0.02 280);
  --color-accent: oklch(0.92 0.04 320);
  --color-accent-foreground: oklch(0.22 0.03 280);
  --color-destructive: oklch(0.6 0.22 25);
  --color-destructive-foreground: oklch(0.99 0.005 90);
  --color-border: oklch(0.92 0.01 280);
  --color-input: oklch(0.92 0.01 280);
  --color-ring: oklch(0.55 0.18 280);
  --radius: 0.625rem;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
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
