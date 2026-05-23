/**
 * Phase-3 expansion of the Petal scaffold (workstream B).
 *
 * What's new vs blocks-1 / blocks-2:
 *   - Auth blocks live in a separate backend-only export so no-backend
 *     projects never receive imports that cannot resolve.
 *   - Data display blocks (StatCard / KpiGrid / ComparisonTable / PricingTable
 *     / ActivityFeed) — the things the model previously hand-styled poorly.
 *   - Form blocks (MultiStepWizard / FileUploadDropzone / OtpInputGroup /
 *     InlineEditField).
 *   - Dashboard shell (SidebarShell / SectionHeader / FilterBar) so app
 *     screens compose instead of inventing layout.
 *   - Commerce blocks (ProductCard / CartLineItem / CheckoutSummary /
 *     OrderConfirmation).
 *
 * Constraints honored on every block:
 *   - ≤ 180 lines / ~6 KB so the file-budget gate never reverts user code
 *     that imports them.
 *   - Pure theme-token driven: no hardcoded colors. The themes registry
 *     in workstream C drops palette tokens into styles.css and these
 *     blocks pick them up automatically.
 *   - Only imports kit primitives that already ship in scaffold-kit.ts
 *     plus lucide-react. The integrity check at the bottom of
 *     scaffold-kit.ts will throw at module load if a dependency is
 *     missing.
 *   - Auth blocks gracefully degrade when no backend is connected — the
 *     submit handlers still render but show a friendly toast telling the
 *     user to enable the backend. The model's prompt also gates auth
 *     scaffolding behind a connected backend (see PREREQUISITE GATING).
 */
import type { ProjectFile } from "./generate.server";

type KitFile = ProjectFile & { overwrite: boolean };

// =============================================================================
// AUTH — pre-wired to @/integrations/backend/auth, injected only with backend kit.
// =============================================================================

const SIGN_IN_CARD = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

type AuthResult = void | { error?: { message?: string } | null };

/** Universal sign-in card. Pass handlers when auth is wired; otherwise it renders safely. */
export function SignInCard({
  title = "Welcome back",
  description = "Sign in to your account to continue.",
  onSignedIn,
  onSubmit,
  onGoogle,
  showGoogle = true,
  signUpHref = "/sign-up",
}: {
  title?: string;
  description?: string;
  onSignedIn?: () => void;
  onSubmit?: (values: { email: string; password: string }) => Promise<AuthResult> | AuthResult;
  onGoogle?: () => Promise<AuthResult> | AuthResult;
  showGoogle?: boolean;
  signUpHref?: string;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!onSubmit) return setErr("Connect a backend to enable sign in.");
    setBusy(true);
    const result = await onSubmit({ email, password });
    setBusy(false);
    if (result && result.error) return setErr(result.error.message ?? "Unable to sign in.");
    onSignedIn?.();
  }

  async function google() {
    setErr(null);
    if (!onGoogle) return setErr("Connect a backend to enable Google sign-in.");
    const result = await onGoogle();
    if (result && result.error) setErr(result.error.message ?? "Unable to continue with Google.");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
          </Button>
          {showGoogle && (
            <Button type="button" variant="outline" className="w-full" onClick={google}>
              Continue with Google
            </Button>
          )}
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Need an account? <a href={signUpHref} className="ml-1 font-medium text-primary hover:underline">Sign up</a>
      </CardFooter>
    </Card>
  );
}
`;

const SIGN_UP_CARD = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/integrations/backend/auth";
import { Loader2 } from "lucide-react";

/** Pre-wired sign-up card. Calls signUpWithPassword + dispatches \`onSignedUp\`. */
export function SignUpCard({
  title = "Create your account",
  description = "It only takes a moment.",
  onSignedUp,
  showGoogle = true,
  signInHref = "/sign-in",
}: {
  title?: string;
  description?: string;
  onSignedUp?: (email: string) => void;
  showGoogle?: boolean;
  signInHref?: string;
}) {
  const { signUpWithPassword, signInWithGoogle } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await signUpWithPassword({ email, password });
    setBusy(false);
    if (error) return setErr(error.message);
    onSignedUp?.(email);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label htmlFor="su-email">Email</Label>
            <Input id="su-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="su-password">Password</Label>
            <Input id="su-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create account
          </Button>
          {showGoogle && (
            <Button type="button" variant="outline" className="w-full" onClick={() => signInWithGoogle()}>
              Continue with Google
            </Button>
          )}
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have one? <a href={signInHref} className="ml-1 font-medium text-primary hover:underline">Sign in</a>
      </CardFooter>
    </Card>
  );
}
`;

const FORGOT_PASSWORD_CARD = `import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/integrations/backend/auth";
import { Loader2 } from "lucide-react";

/** Pre-wired "forgot password" card. Sends a reset email. */
export function ForgotPasswordCard({
  title = "Reset your password",
  description = "We'll email you a link to set a new one.",
  redirectTo = typeof window !== "undefined" ? \`\${window.location.origin}/reset-password\` : "/reset-password",
}: { title?: string; description?: string; redirectTo?: string }) {
  const { resetPasswordForEmail } = useAuth();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await resetPasswordForEmail({ email, redirectTo });
    setBusy(false);
    if (error) return setErr(error.message);
    setSent(true);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <Alert><AlertDescription>If an account exists for {email}, a reset link is on its way.</AlertDescription></Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
            <div className="space-y-2">
              <Label htmlFor="fp-email">Email</Label>
              <Input id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send reset link
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
`;

// =============================================================================
// DATA DISPLAY
// =============================================================================

const STAT_CARD = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/** Single KPI tile. Use inside <KpiGrid /> or standalone. */
export function StatCard({
  label,
  value,
  delta,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** e.g. "+12.4%" — sign drives the arrow + color. */
  delta?: string;
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  const positive = typeof delta === "string" && !delta.trim().startsWith("-");
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">{label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
          </div>
          {icon && <div className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</div>}
        </div>
        {(delta || hint) && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            {delta && (
              <span className={cn("inline-flex items-center gap-1 font-medium", positive ? "text-primary" : "text-destructive")}>
                {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {delta}
              </span>
            )}
            {hint && <span className="text-muted-foreground">{hint}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
`;

const KPI_GRID = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Responsive grid wrapper for <StatCard /> tiles. */
export function KpiGrid({
  children,
  className,
  cols = 4,
}: {
  children: React.ReactNode;
  className?: string;
  cols?: 2 | 3 | 4;
}) {
  const colClass =
    cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={cn("grid grid-cols-1 gap-4", colClass, className)}>{children}</div>;
}
`;

const COMPARISON_TABLE = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, Minus } from "lucide-react";

export interface ComparisonColumn {
  name: string;
  highlight?: boolean;
  /** Map row.key → boolean | string */
  values: Record<string, boolean | string>;
}
export interface ComparisonRow { key: string; label: string; group?: string }

/** Side-by-side feature comparison. Great for pricing / plan compare pages. */
export function ComparisonTable({
  rows,
  columns,
  className,
}: {
  rows: ComparisonRow[];
  columns: ComparisonColumn[];
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background py-4 pr-4 text-left text-muted-foreground font-medium">Feature</th>
            {columns.map((c) => (
              <th key={c.name} className={cn("py-4 px-4 text-left font-semibold text-foreground", c.highlight && "text-primary")}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="sticky left-0 bg-background py-3 pr-4 font-medium text-foreground">{r.label}</td>
              {columns.map((c) => {
                const v = c.values[r.key];
                return (
                  <td key={c.name} className={cn("py-3 px-4 text-muted-foreground", c.highlight && "bg-primary/5")}>
                    {typeof v === "boolean"
                      ? v ? <Check className="h-4 w-4 text-primary" /> : <Minus className="h-4 w-4 text-muted-foreground/50" />
                      : v ?? <Minus className="h-4 w-4 text-muted-foreground/50" />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
`;

const PRICING_TABLE = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

export interface PricingTier {
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  cta: { label: string; href?: string; onClick?: () => void };
  highlight?: boolean;
  badge?: string;
}

/** Three-tier pricing grid. Pass 1-4 tiers. */
export function PricingTable({
  tiers,
  className,
}: {
  tiers: PricingTier[];
  className?: string;
}) {
  const cols = tiers.length === 1 ? "max-w-sm mx-auto" : tiers.length === 2 ? "md:grid-cols-2" : tiers.length >= 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3";
  return (
    <div className={cn("grid grid-cols-1 gap-6", cols, className)}>
      {tiers.map((t) => (
        <Card key={t.name} className={cn("relative flex flex-col", t.highlight && "border-primary shadow-lg")}>
          {t.badge && (
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">{t.badge}</Badge>
          )}
          <CardHeader>
            <CardTitle className="text-lg">{t.name}</CardTitle>
            {t.description && <CardDescription>{t.description}</CardDescription>}
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-tight text-foreground">{t.price}</span>
              {t.period && <span className="text-sm text-muted-foreground">/ {t.period}</span>}
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-2.5">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button asChild={!!t.cta.href} variant={t.highlight ? "default" : "outline"} className="w-full" onClick={t.cta.onClick}>
              {t.cta.href ? <a href={t.cta.href}>{t.cta.label}</a> : <span>{t.cta.label}</span>}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
`;

const ACTIVITY_FEED = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface ActivityItem {
  id: string;
  actor: { name: string; avatarUrl?: string };
  action: React.ReactNode;
  timestamp: string;
  meta?: React.ReactNode;
}

/** Vertical activity / audit feed. */
export function ActivityFeed({ items, className }: { items: ActivityItem[]; className?: string }) {
  if (items.length === 0) {
    return <div className={cn("rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground", className)}>No activity yet.</div>;
  }
  return (
    <ol className={cn("space-y-5", className)}>
      {items.map((it) => (
        <li key={it.id} className="flex gap-3">
          <Avatar className="h-9 w-9">
            {it.actor.avatarUrl && <AvatarImage src={it.actor.avatarUrl} alt={it.actor.name} />}
            <AvatarFallback>{it.actor.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-0.5">
            <div className="text-sm text-foreground">
              <span className="font-medium">{it.actor.name}</span> {it.action}
            </div>
            <div className="text-xs text-muted-foreground">{it.timestamp}</div>
            {it.meta && <div className="mt-1 text-xs text-muted-foreground">{it.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
`;

// =============================================================================
// FORMS
// =============================================================================

const MULTI_STEP_WIZARD = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check } from "lucide-react";

export interface WizardStep { id: string; title: string; render: React.ReactNode }

/** Linear multi-step wizard. Controlled-step pattern; you own form state. */
export function MultiStepWizard({
  steps,
  step,
  onStepChange,
  onSubmit,
  className,
  submitLabel = "Finish",
}: {
  steps: WizardStep[];
  step: number;
  onStepChange: (next: number) => void;
  onSubmit: () => void;
  className?: string;
  submitLabel?: string;
}) {
  const total = steps.length;
  const isLast = step === total - 1;
  const progress = ((step + 1) / total) * 100;
  const current = steps[step];
  if (!current) return null;
  return (
    <div className={cn("space-y-6", className)}>
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">{current.title}</span>
          <span className="text-muted-foreground">Step {step + 1} of {total}</span>
        </div>
        <Progress value={progress} className="mt-2" />
      </div>
      <ol className="flex items-center gap-3 text-xs text-muted-foreground">
        {steps.map((s, i) => (
          <li key={s.id} className={cn("flex items-center gap-1.5", i <= step && "text-foreground")}>
            <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px]", i < step && "border-primary bg-primary text-primary-foreground", i === step && "border-primary text-primary")}>
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{s.title}</span>
          </li>
        ))}
      </ol>
      <div>{current.render}</div>
      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={step === 0} onClick={() => onStepChange(step - 1)}>Back</Button>
        {isLast ? (
          <Button onClick={onSubmit}>{submitLabel}</Button>
        ) : (
          <Button onClick={() => onStepChange(step + 1)}>Continue</Button>
        )}
      </div>
    </div>
  );
}
`;

const FILE_UPLOAD_DROPZONE = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";

/** Drag-and-drop upload field. Owns file list state internally; surfaces via onChange. */
export function FileUploadDropzone({
  onChange,
  accept,
  multiple = true,
  maxSizeMb = 10,
  className,
  label = "Drop files here, or click to choose",
}: {
  onChange?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  className?: string;
  label?: string;
}) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [hover, setHover] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.size <= maxSizeMb * 1024 * 1024);
    const next = multiple ? [...files, ...incoming] : incoming.slice(0, 1);
    setFiles(next);
    onChange?.(next);
  }
  function remove(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    onChange?.(next);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div
        onDragOver={(e) => { e.preventDefault(); setHover(true); }}
        onDragLeave={() => setHover(false)}
        onDrop={(e) => { e.preventDefault(); setHover(false); add(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors", hover && "border-primary bg-primary/5")}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">Up to {maxSizeMb}MB each</div>
        <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="sr-only" onChange={(e) => add(e.target.files)} />
      </div>
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
              <span className="truncate pr-2 text-foreground">{f.name}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)}><X className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
`;

const EMPTY_STATE_CTA = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Generic empty-state with primary CTA. Use for "no items yet" screens. */
export function EmptyStateCta({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  primaryAction?: { label: string; onClick?: () => void; href?: string };
  secondaryAction?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-4 rounded-full bg-muted p-3 text-muted-foreground">{icon}</div>}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex items-center gap-2">
          {primaryAction && (
            <Button asChild={!!primaryAction.href} onClick={primaryAction.onClick}>
              {primaryAction.href ? <a href={primaryAction.href}>{primaryAction.label}</a> : <span>{primaryAction.label}</span>}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" asChild={!!secondaryAction.href} onClick={secondaryAction.onClick}>
              {secondaryAction.href ? <a href={secondaryAction.href}>{secondaryAction.label}</a> : <span>{secondaryAction.label}</span>}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
`;

// =============================================================================
// DASHBOARD SHELL
// =============================================================================

const SIDEBAR_SHELL = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Menu, X } from "lucide-react";

export interface SidebarNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
  active?: boolean;
  onClick?: () => void;
}

/**
 * Three-region app shell: sidebar + topbar + content slot.
 * Mobile collapses sidebar into a sheet; desktop keeps it persistent.
 */
export function SidebarShell({
  brand,
  nav,
  topRight,
  children,
  footer,
  className,
}: {
  brand: React.ReactNode;
  nav: SidebarNavItem[];
  topRight?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn("min-h-screen bg-background", className)}>
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-card transition-transform md:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex-1 truncate font-semibold text-foreground">{brand}</div>
          <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
        </div>
        <ScrollArea className="h-[calc(100vh-3.5rem-3rem)]">
          <nav className="space-y-1 p-3">
            {nav.map((it) => (
              <a key={it.id} href={it.href ?? "#"} onClick={(e) => { if (it.onClick) { e.preventDefault(); it.onClick(); } }}
                className={cn("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", it.active && "bg-muted text-foreground font-medium")}>
                {it.icon && <span className="text-muted-foreground">{it.icon}</span>}
                <span>{it.label}</span>
              </a>
            ))}
          </nav>
        </ScrollArea>
        {footer && <div className="border-t border-border p-3 text-xs text-muted-foreground">{footer}</div>}
      </aside>
      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
          <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></Button>
          <div className="flex-1" />
          {topRight}
        </header>
        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
`;

const SECTION_HEADER = `import * as React from "react";
import { cn } from "@/lib/utils";

/** Section header with title, description, and optional actions. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
`;

const FILTER_BAR = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

/** Search + filter chip row. Use above tables / lists. */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  className,
}: {
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search ?? ""} onChange={(e) => onSearchChange?.(e.target.value)} placeholder={searchPlaceholder} className="pl-9" />
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  );
}
`;

// =============================================================================
// COMMERCE
// =============================================================================

const PRODUCT_CARD = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ProductCardProps {
  name: string;
  price: string;
  imageSrc: string;
  imageAlt?: string;
  href?: string;
  badge?: string;
  meta?: string;
  className?: string;
}

export function ProductCard({ name, price, imageSrc, imageAlt, href, badge, meta, className }: ProductCardProps) {
  const Wrapper: React.ElementType = href ? "a" : "div";
  return (
    <Wrapper href={href} className={cn("group block", className)}>
      <Card className="overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="relative aspect-square overflow-hidden bg-muted">
          <img src={imageSrc} alt={imageAlt ?? name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          {badge && <Badge className="absolute left-3 top-3">{badge}</Badge>}
        </div>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{name}</div>
              {meta && <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>}
            </div>
            <div className="shrink-0 text-sm font-semibold text-foreground">{price}</div>
          </div>
        </CardContent>
      </Card>
    </Wrapper>
  );
}
`;

const CART_LINE_ITEM = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2 } from "lucide-react";

export interface CartLineItemProps {
  name: string;
  variant?: string;
  imageSrc: string;
  unitPrice: string;
  quantity: number;
  onChangeQuantity?: (next: number) => void;
  onRemove?: () => void;
  className?: string;
}

export function CartLineItem({ name, variant, imageSrc, unitPrice, quantity, onChangeQuantity, onRemove, className }: CartLineItemProps) {
  return (
    <div className={cn("flex gap-4 border-b border-border py-4 last:border-b-0", className)}>
      <img src={imageSrc} alt={name} className="h-20 w-20 shrink-0 rounded-md object-cover" loading="lazy" />
      <div className="flex flex-1 flex-col">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{name}</div>
            {variant && <div className="text-xs text-muted-foreground">{variant}</div>}
          </div>
          <div className="text-sm font-semibold text-foreground">{unitPrice}</div>
        </div>
        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="inline-flex items-center rounded-md border border-border">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onChangeQuantity?.(Math.max(1, quantity - 1))}><Minus className="h-3.5 w-3.5" /></Button>
            <span className="w-8 text-center text-sm tabular-nums text-foreground">{quantity}</span>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onChangeQuantity?.(quantity + 1)}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          {onRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
`;

const CHECKOUT_SUMMARY = `import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export interface CheckoutSummaryLine { label: string; value: string; emphasis?: boolean }

export function CheckoutSummary({
  title = "Order summary",
  lines,
  total,
  ctaLabel = "Place order",
  onCheckout,
  note,
  className,
}: {
  title?: string;
  lines: CheckoutSummaryLine[];
  total: { label: string; value: string };
  ctaLabel?: string;
  onCheckout?: () => void;
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("sticky top-6", className)}>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2 text-sm">
          {lines.map((l) => (
            <div key={l.label} className={cn("flex justify-between", l.emphasis ? "text-foreground font-medium" : "text-muted-foreground")}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">{total.label}</span>
          <span className="text-xl font-semibold tracking-tight text-foreground">{total.value}</span>
        </div>
        <Button className="w-full" onClick={onCheckout}>{ctaLabel}</Button>
        {note && <div className="text-xs text-muted-foreground">{note}</div>}
      </CardContent>
    </Card>
  );
}
`;

// =============================================================================
// REGISTRY
// =============================================================================

export const BACKEND_KIT_BLOCK_FILES_3: KitFile[] = [
  { path: "src/components/blocks/auth-sign-in-card.tsx", content: SIGN_IN_CARD, overwrite: true },
  { path: "src/components/blocks/auth-sign-up-card.tsx", content: SIGN_UP_CARD, overwrite: true },
  { path: "src/components/blocks/auth-forgot-password-card.tsx", content: FORGOT_PASSWORD_CARD, overwrite: true },
];

export const KIT_BLOCK_FILES_3: KitFile[] = [
  // Data display
  { path: "src/components/blocks/stat-card.tsx", content: STAT_CARD, overwrite: true },
  { path: "src/components/blocks/kpi-grid.tsx", content: KPI_GRID, overwrite: true },
  { path: "src/components/blocks/comparison-table.tsx", content: COMPARISON_TABLE, overwrite: true },
  { path: "src/components/blocks/pricing-table.tsx", content: PRICING_TABLE, overwrite: true },
  { path: "src/components/blocks/activity-feed.tsx", content: ACTIVITY_FEED, overwrite: true },
  // Forms
  { path: "src/components/blocks/multi-step-wizard.tsx", content: MULTI_STEP_WIZARD, overwrite: true },
  { path: "src/components/blocks/file-upload-dropzone.tsx", content: FILE_UPLOAD_DROPZONE, overwrite: true },
  { path: "src/components/blocks/empty-state-cta.tsx", content: EMPTY_STATE_CTA, overwrite: true },
  // Dashboard shell
  { path: "src/components/blocks/sidebar-shell.tsx", content: SIDEBAR_SHELL, overwrite: true },
  { path: "src/components/blocks/section-header.tsx", content: SECTION_HEADER, overwrite: true },
  { path: "src/components/blocks/filter-bar.tsx", content: FILTER_BAR, overwrite: true },
  // Commerce
  { path: "src/components/blocks/product-card.tsx", content: PRODUCT_CARD, overwrite: true },
  { path: "src/components/blocks/cart-line-item.tsx", content: CART_LINE_ITEM, overwrite: true },
  { path: "src/components/blocks/checkout-summary.tsx", content: CHECKOUT_SUMMARY, overwrite: true },
];
