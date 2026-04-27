/**
 * Curated "copy-from" reference patterns for the AI.
 *
 * These files live under `src/components/examples/` and are NEVER imported
 * by App.tsx. They exist purely as a high-quality source of patterns the
 * AI can read and adapt for the user's actual feature work.
 *
 * Licensing: every block here is original code authored for Petal. They
 * compose only the canonical shadcn-style primitives already shipped in
 * `src/components/ui/*` (MIT) plus lucide-react icons (ISC). No verbatim
 * copies from third-party landing pages, paid template kits, or other
 * proprietary sources. Safe to ship under our own terms.
 *
 * Naming convention: `<surface>-<intent>.tsx`, e.g. `auth-sign-in-card.tsx`.
 * Keep each file:
 *   - Self-contained (one default export, one screen / one block)
 *   - <200 lines
 *   - Semantic-token only — never raw hex / Tailwind colour names
 *   - Light + dark friendly via design tokens
 *   - No data fetching, no router — these are pure presentational refs
 */
import type { ProjectFile } from "./generate.server";

/* =================================================================
 * AUTH (4)
 * ================================================================= */

const AUTH_SIGN_IN_CARD = `import { useState } from "react";
import { Mail, Lock, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/**
 * Centered sign-in card. Pair with /signup and /forgot-password routes.
 * Replace the submit handler with your real auth call.
 */
export default function SignInCard() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm border-border/60 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to continue to your workspace</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              setTimeout(() => setLoading(false), 800);
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" placeholder="you@company.com" className="pl-9" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <a className="text-xs text-muted-foreground hover:text-foreground" href="#">
                  Forgot?
                </a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" type="password" placeholder="••••••••" className="pl-9" required />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button variant="outline" className="w-full">
            Continue with Google
          </Button>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          New here?&nbsp;<a className="font-medium text-foreground hover:underline" href="#">Create an account</a>
        </CardFooter>
      </Card>
    </div>
  );
}
`;

const AUTH_SIGN_UP_SPLIT = `import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Split-screen sign-up: brand panel left, form right.
 * Mirror of common SaaS onboarding pattern.
 */
export default function SignUpSplit() {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <aside className="relative hidden bg-gradient-to-br from-primary/15 via-background to-background lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Petal
        </div>
        <div className="space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
            Build something the world hasn't seen yet.
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Start free. No credit card. Invite your team when you're ready.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">© Petal Labs</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <form className="w-full max-w-sm space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Create your account</h1>
            <p className="text-sm text-muted-foreground">It takes less than a minute.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first">First name</Label>
              <Input id="first" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">Last name</Label>
              <Input id="last" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required />
            <p className="text-[11px] text-muted-foreground">At least 8 characters with one number.</p>
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox id="tos" defaultChecked className="mt-0.5" />
            I agree to the Terms of Service and Privacy Policy.
          </label>
          <Button type="submit" className="w-full">Create account</Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have one?&nbsp;<a className="font-medium text-foreground hover:underline" href="#">Sign in</a>
          </p>
        </form>
      </main>
    </div>
  );
}
`;

const AUTH_FORGOT_PASSWORD = `import { useState, type FormEvent } from "react";
import { ArrowLeft, MailCheck, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/integrations/backend/auth";

/**
 * Forgot-password flow with success confirmation state.
 *
 * Wired to \`useAuth().resetPasswordForEmail\`, which sends an email linking
 * back to \`/reset-password\` — make sure that route is mounted (see
 * \`auth-reset-password.tsx\` in this folder).
 */
export default function ForgotPassword() {
  const { resetPasswordForEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    const { error } = await resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <a href="/" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Back to sign in
          </a>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            We'll email you a link to set a new password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Check your inbox</p>
                <p className="text-xs text-muted-foreground">
                  If an account exists for that email, a reset link is on the way.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
              {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send reset link
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
`;

const AUTH_RESET_PASSWORD = `import { useEffect, useState, type FormEvent } from "react";
import { Lock, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/integrations/backend/auth";

/**
 * /reset-password landing page.
 *
 * The recovery email from \`resetPasswordForEmail\` links here with an
 * active recovery session already in the URL hash. AuthProvider picks it
 * up automatically; this page just collects a new password and calls
 * \`updatePassword\`.
 *
 * Mount this at the public route \`/reset-password\` (it must NOT be
 * behind your auth gate).
 */
export default function ResetPassword() {
  const { updatePassword, session, loading: authLoading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !session) {
      setErrorMsg("This reset link has expired. Request a new one.");
    }
  }, [authLoading, session]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    const { error } = await updatePassword(password);
    setSubmitting(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      window.location.assign("/");
    }, 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>
            Choose a strong password you haven't used before.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium">Password updated</p>
              <p className="text-xs text-muted-foreground">Redirecting…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={8}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
              {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
              <Button type="submit" className="w-full" disabled={submitting || authLoading || !session}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
`;

const AUTH_OTP_CARD = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * One-time-code verification screen. Use after passwordless sign-in or
 * 2FA challenge. Slot count is six by convention.
 */
export default function OtpCard() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Enter your code</CardTitle>
          <CardDescription>We sent a six-digit code to your email.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <InputOTP maxLength={6}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
          <Button className="w-full">Verify and continue</Button>
          <button className="text-xs text-muted-foreground hover:text-foreground">
            Didn't receive it? Resend
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
`;

/* =================================================================
 * DASHBOARD (5)
 * ================================================================= */

const DASHBOARD_STATS_GRID = `import { ArrowDownRight, ArrowUpRight, DollarSign, ShoppingCart, Users, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Stat = { label: string; value: string; delta: number; icon: React.ComponentType<{ className?: string }> };

const STATS: Stat[] = [
  { label: "Revenue", value: "$48,294", delta: 12.4, icon: DollarSign },
  { label: "Orders", value: "1,294", delta: 4.1, icon: ShoppingCart },
  { label: "Active users", value: "8,212", delta: -2.3, icon: Users },
  { label: "Sessions", value: "23,402", delta: 9.8, icon: Activity },
];

/**
 * Four-up KPI grid. Drop at the top of any dashboard route.
 */
export default function StatsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {STATS.map((s) => {
        const positive = s.delta >= 0;
        const Icon = s.icon;
        return (
          <Card key={s.label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-tight">{s.value}</div>
              <p className={\`mt-1 inline-flex items-center gap-1 text-xs \${positive ? "text-green-600 dark:text-green-400" : "text-destructive"}\`}>
                {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(s.delta)}% from last week
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
`;

const DASHBOARD_SIDEBAR_LAYOUT = `import { Home, BarChart3, Users, Settings, Bell, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const NAV = [
  { label: "Overview", icon: Home, active: true },
  { label: "Analytics", icon: BarChart3 },
  { label: "Customers", icon: Users },
  { label: "Settings", icon: Settings },
];

/**
 * Persistent left-rail dashboard layout. Slot route content into <main>.
 */
export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-background lg:flex lg:flex-col">
        <div className="flex h-14 items-center px-4 font-semibold">Acme Co</div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <a
                key={n.label}
                href="#"
                className={\`flex items-center gap-2 rounded-md px-3 py-2 text-sm \${
                  n.active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }\`}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </a>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 border-t border-border p-3 text-sm">
          <Avatar className="h-7 w-7">
            <AvatarFallback>AB</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="text-xs font-medium">Anna Bell</p>
            <p className="text-[11px] text-muted-foreground">Admin</p>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search…" className="pl-9" />
          </div>
          <Button variant="ghost" size="icon">
            <Bell className="h-4 w-4" />
          </Button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
`;

const DASHBOARD_CHART_CARD = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Analytics card with range tabs and a simple SVG sparkline placeholder.
 * Swap the polyline for a chart library when wiring real data.
 */
export default function ChartCard() {
  const points = "0,40 20,32 40,36 60,18 80,22 100,12 120,18 140,8 160,14 180,4";
  return (
    <Card>
      <CardHeader className="flex-row items-end justify-between space-y-0">
        <div>
          <CardTitle>Weekly traffic</CardTitle>
          <CardDescription>Sessions across all properties</CardDescription>
        </div>
        <Tabs defaultValue="7d">
          <TabsList>
            <TabsTrigger value="7d">7d</TabsTrigger>
            <TabsTrigger value="30d">30d</TabsTrigger>
            <TabsTrigger value="90d">90d</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">23,402</div>
        <p className="text-xs text-muted-foreground">+9.8% vs previous period</p>
        <svg viewBox="0 0 180 48" className="mt-4 h-20 w-full">
          <polyline
            points={points}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </CardContent>
    </Card>
  );
}
`;

const DASHBOARD_ACTIVITY_FEED = `import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Event = { who: string; what: string; when: string; tag?: "info" | "success" | "warn" };

const EVENTS: Event[] = [
  { who: "Maria Lopez", what: "deployed v2.4 to production", when: "2m", tag: "success" },
  { who: "Devon Park", what: "opened a new support ticket", when: "14m", tag: "warn" },
  { who: "Yuki Tanaka", what: "invited 3 new teammates", when: "1h", tag: "info" },
  { who: "Sam Reed", what: "renamed the workspace", when: "3h" },
];

const variant: Record<NonNullable<Event["tag"]>, "default" | "secondary" | "destructive"> = {
  info: "secondary",
  success: "default",
  warn: "destructive",
};

/**
 * Vertical activity feed for dashboards and project sidebars.
 */
export default function ActivityFeed() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Latest changes across your team</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          {EVENTS.map((e, i) => (
            <li key={i} className="flex items-start gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">
                  {e.who.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-sm">
                <p>
                  <span className="font-medium">{e.who}</span>{" "}
                  <span className="text-muted-foreground">{e.what}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{e.when} ago</p>
              </div>
              {e.tag && <Badge variant={variant[e.tag]}>{e.tag}</Badge>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
`;

const DASHBOARD_EMPTY_STATE = `import { Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Friendly empty-state block for any list/table that hasn't been populated yet.
 */
export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-background ring-1 ring-border">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold">No items yet</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Create your first item to get started. You can always change or delete it later.
      </p>
      <Button className="mt-4 inline-flex items-center gap-1.5">
        <Plus className="h-4 w-4" /> Create item
      </Button>
    </div>
  );
}
`;

/* =================================================================
 * PRICING (3)
 * ================================================================= */

const PRICING_THREE_TIER = `import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Tier = { name: string; price: string; cadence: string; tagline: string; features: string[]; cta: string; featured?: boolean };

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "$0",
    cadence: "/forever",
    tagline: "For tinkerers and side-projects.",
    features: ["1 project", "Community support", "Public projects only"],
    cta: "Get started",
  },
  {
    name: "Pro",
    price: "$19",
    cadence: "/month",
    tagline: "For makers shipping real products.",
    features: ["Unlimited projects", "Email support", "Custom domains", "Private projects"],
    cta: "Start free trial",
    featured: true,
  },
  {
    name: "Team",
    price: "$49",
    cadence: "/seat / month",
    tagline: "For teams that build together.",
    features: ["Everything in Pro", "Role-based access", "SSO + SAML", "Audit log"],
    cta: "Talk to sales",
  },
];

/**
 * Three-tier pricing block. Highlight the middle plan with \`featured\`.
 */
export default function PricingThreeTier() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Simple, honest pricing</h2>
        <p className="mt-3 text-muted-foreground">Start free. Upgrade when it pays for itself.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <Card key={t.name} className={t.featured ? "border-primary shadow-lg" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t.name}</CardTitle>
                {t.featured && <Badge>Most popular</Badge>}
              </div>
              <CardDescription>{t.tagline}</CardDescription>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
                <span className="text-sm text-muted-foreground">{t.cadence}</span>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button variant={t.featured ? "default" : "outline"} className="w-full">{t.cta}</Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}
`;

const PRICING_TOGGLE_BILLING = `import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const PLANS = [
  { name: "Hobby", monthly: 0, annual: 0, perks: ["1 site", "100k requests / mo"] },
  { name: "Pro", monthly: 24, annual: 19, perks: ["Unlimited sites", "10M requests / mo", "Priority support"] },
];

/**
 * Pricing block with monthly/annual toggle and 20% savings call-out.
 */
export default function PricingToggleBilling() {
  const [annual, setAnnual] = useState(true);
  return (
    <section className="mx-auto max-w-4xl px-4 py-20">
      <div className="mb-10 flex flex-col items-center gap-4">
        <h2 className="text-3xl font-semibold tracking-tight">Pick a plan</h2>
        <div className="flex items-center gap-3 rounded-full border border-border bg-muted/30 px-4 py-1.5 text-sm">
          <Label htmlFor="billing-toggle" className={annual ? "text-muted-foreground" : "font-medium"}>Monthly</Label>
          <Switch id="billing-toggle" checked={annual} onCheckedChange={setAnnual} />
          <Label htmlFor="billing-toggle" className={annual ? "font-medium" : "text-muted-foreground"}>
            Annual <span className="ml-1 text-xs text-primary">−20%</span>
          </Label>
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {PLANS.map((p) => {
          const price = annual ? p.annual : p.monthly;
          return (
            <Card key={p.name}>
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold">\${price}</span>
                  <span className="text-sm text-muted-foreground">/{annual ? "mo, billed annually" : "month"}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {p.perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {perk}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button className="w-full">Choose {p.name}</Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
`;

const PRICING_COMPARISON_TABLE = `import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ROWS = [
  { feature: "Projects", starter: "1", pro: "Unlimited", team: "Unlimited" },
  { feature: "Custom domain", starter: false, pro: true, team: true },
  { feature: "Role-based access", starter: false, pro: false, team: true },
  { feature: "SSO + SAML", starter: false, pro: false, team: true },
  { feature: "Audit log", starter: false, pro: false, team: true },
  { feature: "Email support", starter: false, pro: true, team: true },
];

function Cell({ v }: { v: string | boolean }) {
  if (typeof v === "string") return <span className="text-sm">{v}</span>;
  return v ? <Check className="h-4 w-4 text-primary" /> : <Minus className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Side-by-side feature comparison table to pair with a pricing grid.
 */
export default function PricingComparisonTable() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16">
      <h2 className="mb-6 text-center text-2xl font-semibold tracking-tight">Compare plans</h2>
      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/3">Feature</TableHead>
              <TableHead>Starter</TableHead>
              <TableHead>Pro</TableHead>
              <TableHead>Team</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((r) => (
              <TableRow key={r.feature}>
                <TableCell className="font-medium">{r.feature}</TableCell>
                <TableCell><Cell v={r.starter} /></TableCell>
                <TableCell><Cell v={r.pro} /></TableCell>
                <TableCell><Cell v={r.team} /></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell></TableCell>
              <TableCell><Button size="sm" variant="outline">Choose</Button></TableCell>
              <TableCell><Button size="sm">Choose</Button></TableCell>
              <TableCell><Button size="sm" variant="outline">Choose</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
`;

/* =================================================================
 * HERO (4)
 * ================================================================= */

const HERO_CENTERED_GRADIENT = `import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Centered marketing hero with gradient backdrop, eyebrow badge, and dual CTAs.
 */
export default function CenteredGradientHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.12),_transparent_60%)]" />
      <div className="mx-auto flex max-w-4xl flex-col items-center px-4 py-24 text-center sm:py-32">
        <Badge variant="secondary" className="mb-6 inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Now in public beta
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Ship products at the speed of thought.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          A workspace built for makers, designers, and tiny teams who want to move quickly without the bloat.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="inline-flex items-center gap-1.5">
            Get started <ArrowRight className="h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline">Watch demo</Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">No credit card required</p>
      </div>
    </section>
  );
}
`;

const HERO_SPLIT_SCREENSHOT = `import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Split hero: copy left, product mock right. The mock is a styled placeholder
 * card — replace with a real screenshot when ready.
 */
export default function SplitScreenshotHero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 lg:grid-cols-2 lg:py-28">
      <div>
        <p className="mb-3 text-sm font-medium text-primary">Built for product teams</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Plan, build, and launch — all in one place.
        </h1>
        <p className="mt-5 max-w-lg text-muted-foreground">
          Replace your patchwork of tools with one clean surface. Your team will thank you.
        </p>
        <div className="mt-7 flex gap-3">
          <Button className="inline-flex items-center gap-1.5">
            Start free <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost">See pricing →</Button>
        </div>
      </div>
      <div className="relative">
        <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br from-primary/20 via-transparent to-transparent blur-2xl" />
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          <div className="aspect-[16/10] bg-gradient-to-br from-muted/40 to-muted/10" />
        </div>
      </div>
    </section>
  );
}
`;

const HERO_LOGO_CLOUD = `/**
 * Social-proof logo cloud. Replace text-only "logos" with real SVG logos
 * once you have them. Keep this neutral — too colorful and it competes
 * with the page CTA.
 */
const LOGOS = ["Acme", "Globex", "Initech", "Hooli", "Umbrella", "Soylent"];

export default function LogoCloud() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-12">
      <p className="mb-6 text-center text-xs uppercase tracking-widest text-muted-foreground">
        Trusted by teams at
      </p>
      <div className="grid grid-cols-3 gap-8 opacity-70 sm:grid-cols-6">
        {LOGOS.map((l) => (
          <div key={l} className="flex items-center justify-center text-sm font-semibold tracking-tight text-muted-foreground">
            {l}
          </div>
        ))}
      </div>
    </section>
  );
}
`;

const HERO_FEATURE_BAND = `import { Bolt, ShieldCheck, GitBranch, Globe } from "lucide-react";

const FEATURES = [
  { icon: Bolt, title: "Fast by default", body: "Tuned for sub-second interactions, even on slow networks." },
  { icon: ShieldCheck, title: "Secure", body: "SOC2-aligned defaults so you don't have to think about it." },
  { icon: GitBranch, title: "Versioned", body: "Every change is auditable. Roll back in one click." },
  { icon: Globe, title: "Global", body: "Edge-first delivery to every continent except Antarctica." },
];

/**
 * Four-up feature band to sit below the hero.
 */
export default function FeatureBand() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="space-y-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
`;

/* =================================================================
 * FORMS (4)
 * ================================================================= */

const FORM_PROFILE_SETTINGS = `import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

/**
 * Two-column profile settings form. Use inside a Tabs > "Profile" panel.
 */
export default function ProfileSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How others see you across the workspace.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16"><AvatarFallback>AB</AvatarFallback></Avatar>
          <div className="space-x-2">
            <Button variant="outline" size="sm">Upload</Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground">Remove</Button>
          </div>
        </div>
        <Separator />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" defaultValue="Anna Bell" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" defaultValue="anna" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bio">Bio</Label>
          <Textarea id="bio" rows={3} placeholder="Tell people what you're working on" />
          <p className="text-xs text-muted-foreground">Markdown supported.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost">Cancel</Button>
          <Button>Save changes</Button>
        </div>
      </CardContent>
    </Card>
  );
}
`;

const FORM_MULTI_STEP = `import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

const STEPS = ["Account", "Workspace", "Invite team"];

/**
 * Three-step onboarding wizard with progress bar. Replace each panel with
 * the real fields for that step.
 */
export default function MultiStepForm() {
  const [step, setStep] = useState(0);
  const pct = ((step + 1) / STEPS.length) * 100;
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {step + 1} of {STEPS.length}</span>
          <span>{STEPS[step]}</span>
        </div>
        <Progress value={pct} />
        <CardTitle className="text-xl">{STEPS[step]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 0 && (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" /></div>
            <div className="space-y-1.5"><Label>Password</Label><Input type="password" /></div>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Workspace name</Label><Input placeholder="Acme Co" /></div>
            <div className="space-y-1.5"><Label>Subdomain</Label><Input placeholder="acme" /></div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Teammate emails</Label><Input placeholder="comma-separated" /></div>
            <p className="text-xs text-muted-foreground">You can always invite more later.</p>
          </div>
        )}
        <div className="flex justify-between pt-2">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>Continue</Button>
          ) : (
            <Button className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4" /> Finish
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
`;

const FORM_CONTACT = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Public-facing contact form with reason dropdown. Pair with /contact route.
 */
export default function ContactForm() {
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>Get in touch</CardTitle>
        <CardDescription>We typically reply within one business day.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" required /></div>
            <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" required /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Select>
              <SelectTrigger id="reason"><SelectValue placeholder="Choose one" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="msg">Message</Label>
            <Textarea id="msg" rows={5} placeholder="How can we help?" required />
          </div>
          <div className="flex justify-end">
            <Button type="submit">Send message</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
`;

const FORM_INLINE_VALIDATION = `import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function strength(pwd: string): { score: number; label: string } {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return { score, label: ["Too short", "Weak", "Okay", "Strong", "Excellent"][score] };
}

/**
 * Inline-validated password field with strength meter. The pattern scales
 * to any field that needs live feedback before submit.
 */
export default function InlineValidation() {
  const [pwd, setPwd] = useState("");
  const s = strength(pwd);
  const colors = ["bg-muted", "bg-destructive", "bg-yellow-500", "bg-primary", "bg-green-500"];
  const valid = s.score >= 3;

  return (
    <form className="mx-auto max-w-sm space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="pwd">Choose a password</Label>
        <Input
          id="pwd"
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          aria-invalid={pwd.length > 0 && !valid}
        />
      </div>
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={\`h-1 flex-1 rounded-full \${i < s.score ? colors[s.score] : "bg-muted"}\`} />
        ))}
      </div>
      <p className={\`flex items-center gap-1 text-xs \${valid ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}\`}>
        {valid ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
        {pwd ? s.label : "8+ chars, mix of cases, numbers, and symbols"}
      </p>
      <Button type="submit" disabled={!valid} className="w-full">Create account</Button>
    </form>
  );
}
`;

/* =================================================================
 * TABLES (4)
 * ================================================================= */

const TABLE_USERS_LIST = `import { MoreHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type User = { name: string; email: string; role: "Owner" | "Admin" | "Member"; status: "Active" | "Invited" };

const USERS: User[] = [
  { name: "Anna Bell", email: "anna@acme.co", role: "Owner", status: "Active" },
  { name: "Devon Park", email: "devon@acme.co", role: "Admin", status: "Active" },
  { name: "Yuki Tanaka", email: "yuki@acme.co", role: "Member", status: "Active" },
  { name: "Sam Reed", email: "sam@acme.co", role: "Member", status: "Invited" },
];

/**
 * Team members table with avatar cell, role badge, and per-row actions menu.
 */
export default function UsersList() {
  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"><Checkbox /></TableHead>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {USERS.map((u) => (
            <TableRow key={u.email}>
              <TableCell><Checkbox /></TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {u.name.split(" ").map((p) => p[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
              <TableCell>
                <span className={\`inline-flex h-2 w-2 rounded-full \${u.status === "Active" ? "bg-green-500" : "bg-yellow-500"}\`} />
                <span className="ml-2 text-sm text-muted-foreground">{u.status}</span>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>Change role</DropdownMenuItem>
                    <DropdownMenuItem>Resend invite</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
`;

const TABLE_INVOICES = `import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Status = "Paid" | "Open" | "Overdue";

const INVOICES: Array<{ id: string; date: string; total: string; status: Status }> = [
  { id: "INV-1042", date: "Apr 18, 2026", total: "$129.00", status: "Paid" },
  { id: "INV-1041", date: "Mar 18, 2026", total: "$129.00", status: "Paid" },
  { id: "INV-1040", date: "Feb 18, 2026", total: "$229.00", status: "Open" },
  { id: "INV-1039", date: "Jan 18, 2026", total: "$129.00", status: "Overdue" },
];

const variant: Record<Status, "default" | "secondary" | "destructive"> = {
  Paid: "secondary",
  Open: "default",
  Overdue: "destructive",
};

/**
 * Invoices / billing-history table with download per row and a totals footer.
 */
export default function InvoicesTable() {
  return (
    <div className="rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Download</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {INVOICES.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-medium">{i.id}</TableCell>
              <TableCell className="text-muted-foreground">{i.date}</TableCell>
              <TableCell>{i.total}</TableCell>
              <TableCell><Badge variant={variant[i.status]}>{i.status}</Badge></TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Download className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
`;

const TABLE_FILTER_TOOLBAR = `import { useState } from "react";
import { Filter, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Order = { id: string; customer: string; total: string; status: "Fulfilled" | "Pending" | "Refunded" };

const ORDERS: Order[] = [
  { id: "#3201", customer: "Lina Cho", total: "$240.00", status: "Fulfilled" },
  { id: "#3200", customer: "Marc Aubin", total: "$92.50", status: "Pending" },
  { id: "#3199", customer: "Priya Nair", total: "$540.00", status: "Fulfilled" },
  { id: "#3198", customer: "Tom Reilly", total: "$60.00", status: "Refunded" },
];

const tone: Record<Order["status"], "default" | "secondary" | "destructive"> = {
  Fulfilled: "secondary",
  Pending: "default",
  Refunded: "destructive",
};

/**
 * Table with a sticky filter toolbar above: free-text search, status select,
 * and a primary action.
 */
export default function FilterToolbarTable() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const rows = ORDERS.filter((o) =>
    (status === "all" || o.status.toLowerCase() === status) &&
    (q === "" || o.customer.toLowerCase().includes(q.toLowerCase()) || o.id.includes(q)),
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders…" className="pl-9" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="inline-flex items-center gap-1.5">
          <Filter className="h-4 w-4" /> More filters
        </Button>
        <div className="ml-auto" />
        <Button className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" /> New order</Button>
      </div>
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">No matching orders</TableCell></TableRow>
            ) : rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.id}</TableCell>
                <TableCell>{o.customer}</TableCell>
                <TableCell>{o.total}</TableCell>
                <TableCell><Badge variant={tone[o.status]}>{o.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
`;

const TABLE_PAGINATED = `import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type Row = { id: number; product: string; sku: string; qty: number };

const DATA: Row[] = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1,
  product: ["Sky Tee", "Cotton Hoodie", "Linen Cap", "Canvas Tote"][i % 4],
  sku: \`SKU-\${1000 + i}\`,
  qty: ((i * 7) % 90) + 5,
}));

const PAGE_SIZE = 8;

/**
 * Paginated, sortable table. Sorting is local for the example — wire to the
 * server when you have one.
 */
export default function PaginatedTable() {
  const [page, setPage] = useState(1);
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => [...DATA].sort((a, b) => sortDesc ? b.qty - a.qty : a.qty - b.qty), [sortDesc]);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" className="-ml-3 h-7" onClick={() => setSortDesc((s) => !s)}>
                  Qty <ArrowUpDown className="ml-1 h-3 w-3" />
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.product}</TableCell>
                <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                <TableCell>{r.qty}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#" onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(1, p - 1)); }} />
          </PaginationItem>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <PaginationItem key={n}>
              <PaginationLink href="#" isActive={n === page} onClick={(e) => { e.preventDefault(); setPage(n); }}>
                {n}
              </PaginationLink>
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext href="#" onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
`;

/* =================================================================
 * ONBOARDING FLOW (4 + 1 orchestrator)
 *
 * A complete, opinionated onboarding journey assembled from the auth
 * primitives above. Each screen is a self-contained presentational
 * component; `onboarding-flow.tsx` is the state-machine that strings
 * them together (welcome → signup → verify OTP → done), with a
 * forgot-password side-route reachable from the welcome screen.
 * ================================================================= */

const ONBOARDING_WELCOME = `import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Welcome / hero screen — first thing a new user sees.
 * Two CTAs: primary (get started → signup) and secondary (sign in).
 * Pure presentational — wire \`onPrimary\` / \`onSecondary\` to your router or flow state.
 */
export interface WelcomeProps {
  appName?: string;
  tagline?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export default function OnboardingWelcome({
  appName = "Acme",
  tagline = "The fastest way to ship beautiful product.",
  onPrimary,
  onSecondary,
}: WelcomeProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* ambient gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.18),transparent_60%)]"
      />
      <div className="relative z-10 mx-auto max-w-xl text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          New here? You're in the right place.
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Welcome to {appName}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-balance text-muted-foreground">
          {tagline}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="w-full sm:w-auto" onClick={onPrimary}>
            Get started
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto" onClick={onSecondary}>
            I already have an account
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Free to try. No credit card required.
        </p>
      </div>
    </div>
  );
}
`;

const ONBOARDING_SIGNUP_STEP = `import { useState, type FormEvent } from "react";
import { Mail, Lock, User, Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Signup step inside the onboarding flow.
 * Collects name + email + password, then calls \`onSubmit({ email })\` so
 * the orchestrator can advance to the OTP step with the email pre-filled.
 */
export interface SignupStepProps {
  onBack?: () => void;
  onSubmit?: (data: { name: string; email: string; password: string }) => void | Promise<void>;
}

export default function OnboardingSignupStep({ onBack, onSubmit }: SignupStepProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit?.({ name, email, password });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm border-border/60 shadow-xl">
        <CardHeader className="space-y-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mb-2 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
          )}
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>It only takes a minute. We'll send a verification code next.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" className="pl-9" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="pl-9" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" minLength={8} className="pl-9" required />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Continue
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              By continuing you agree to our Terms and Privacy Policy.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
`;

const ONBOARDING_VERIFY_STEP = `import { useState, type FormEvent } from "react";
import { ShieldCheck, Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/**
 * OTP verification step. Receives the email from the signup step and
 * calls \`onVerify(code)\` once a 6-digit code is entered.
 */
export interface VerifyStepProps {
  email: string;
  onBack?: () => void;
  onVerify?: (code: string) => void | Promise<void>;
  onResend?: () => void | Promise<void>;
}

export default function OnboardingVerifyStep({ email, onBack, onVerify, onResend }: VerifyStepProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    try {
      await onVerify?.(code);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm border-border/60 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="mx-auto mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
          )}
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Verify your email</CardTitle>
          <CardDescription>
            Enter the 6-digit code we sent to <span className="font-medium text-foreground">{email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={code} onChange={setCode}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify and continue
            </Button>
            <div className="text-center text-xs text-muted-foreground">
              Didn't get a code?{" "}
              <button type="button" onClick={() => onResend?.()} className="text-foreground hover:underline">
                Resend
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
`;

const ONBOARDING_SUCCESS = `import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Final success screen. Show after OTP verification succeeds.
 */
export interface SuccessProps {
  onContinue?: () => void;
  appName?: string;
}

export default function OnboardingSuccess({ onContinue, appName = "Acme" }: SuccessProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">You're all set</h1>
        <p className="mx-auto mt-3 max-w-sm text-muted-foreground">
          Welcome aboard. Your {appName} workspace is ready — let's get you to the good stuff.
        </p>
        <Button size="lg" className="mt-8" onClick={onContinue}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
`;

const ONBOARDING_FLOW = `import { useState } from "react";
import { toast } from "@/components/ui/toast";
import OnboardingWelcome from "./onboarding-welcome";
import OnboardingSignupStep from "./onboarding-signup-step";
import OnboardingVerifyStep from "./onboarding-verify-step";
import OnboardingSuccess from "./onboarding-success";
import AuthForgotPassword from "./auth-forgot-password";
import { useAuth } from "@/integrations/backend/auth";

/**
 * Complete onboarding flow orchestrator.
 *
 * State machine: welcome → signup → verify → done
 * Side branch:   welcome → forgot-password → welcome
 *
 * Wired to \`useAuth()\` from \`@/integrations/backend/auth\`:
 *   - signup submit  → signUpWithPassword (sends confirmation OTP)
 *   - OTP verify     → verifySignupOtp   (signup-type code, NOT generic email OTP)
 *   - resend         → resendSignupOtp
 */
type Step = "welcome" | "signup" | "verify" | "done" | "forgot";

export default function OnboardingFlow({ appName = "Acme" }: { appName?: string }) {
  const { signUpWithPassword, verifySignupOtp, resendSignupOtp } = useAuth();
  const [step, setStep] = useState<Step>("welcome");
  const [email, setEmail] = useState("");

  switch (step) {
    case "welcome":
      return (
        <OnboardingWelcome
          appName={appName}
          onPrimary={() => setStep("signup")}
          onSecondary={() => setStep("forgot")}
        />
      );

    case "signup":
      return (
        <OnboardingSignupStep
          onBack={() => setStep("welcome")}
          onSubmit={async ({ email: e, password }) => {
            const { error } = await signUpWithPassword(e, password);
            if (error) {
              toast.error(error.message);
              return;
            }
            setEmail(e);
            setStep("verify");
          }}
        />
      );

    case "verify":
      return (
        <OnboardingVerifyStep
          email={email}
          onBack={() => setStep("signup")}
          onVerify={async (code) => {
            const { error } = await verifySignupOtp(email, code);
            if (error) {
              toast.error(error.message);
              return;
            }
            setStep("done");
          }}
          onResend={async () => {
            const { error } = await resendSignupOtp(email);
            if (error) {
              toast.error(error.message);
              return;
            }
            toast.success("Code resent — check your inbox.");
          }}
        />
      );

    case "forgot":
      // \`AuthForgotPassword\`'s "Back to sign in" link does a full-page nav
      // to "/", which naturally resets this state machine to "welcome" on
      // reload. If you add a router, wire its onClick to setStep("welcome")
      // instead.
      return <AuthForgotPassword />;

    case "done":
      return <OnboardingSuccess appName={appName} onContinue={() => { /* navigate to /app */ }} />;
  }
}
`;

/* =================================================================
 * AUTH MODALS (4) — Dialog / Sheet variants
 *
 * Modal/overlay versions of the auth screens for apps that prefer to
 * surface auth inline (e.g. "Sign in" button in a marketing nav) rather
 * than route to a dedicated page. Each is controlled (\`open\` + \`onOpenChange\`)
 * so the parent owns state. Submit handlers are placeholders — wire them
 * to your real auth provider.
 * ================================================================= */

const AUTH_SIGN_UP_DIALOG = `import { useState, type FormEvent } from "react";
import { Loader2, Mail, Lock, User } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/**
 * Modal sign-up form. Use when auth should overlay the current page
 * (e.g. paywall, "claim your free trial" CTA on a landing page).
 */
export interface SignUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignIn?: () => void;
  onSubmit?: (data: { name: string; email: string; password: string }) => void | Promise<void>;
}

export default function SignUpDialog({ open, onOpenChange, onSwitchToSignIn, onSubmit }: SignUpDialogProps) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    try {
      await onSubmit?.({
        name: String(fd.get("name") ?? ""),
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-left">
          <DialogTitle>Create your account</DialogTitle>
          <DialogDescription>Free forever for personal use. No credit card required.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="su-name">Full name</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="su-name" name="name" placeholder="Ada Lovelace" className="pl-9" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="su-email" name="email" type="email" placeholder="you@company.com" className="pl-9" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="su-password" name="password" type="password" placeholder="At least 8 characters" minLength={8} className="pl-9" required />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create account
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button type="button" variant="outline" className="w-full">Continue with Google</Button>
        </form>
        <DialogFooter className="sm:justify-center">
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button type="button" onClick={onSwitchToSignIn} className="font-medium text-foreground hover:underline">
              Sign in
            </button>
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
`;

const AUTH_SIGN_IN_DIALOG = `import { useState, type FormEvent } from "react";
import { Loader2, Mail, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/**
 * Modal sign-in form. Mirror of \`auth-sign-up-dialog\` for the return-user flow.
 * Includes hooks for switching to sign-up and opening the password-reset sheet.
 */
export interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignUp?: () => void;
  onForgotPassword?: () => void;
  onSubmit?: (data: { email: string; password: string }) => void | Promise<void>;
}

export default function SignInDialog({ open, onOpenChange, onSwitchToSignUp, onForgotPassword, onSubmit }: SignInDialogProps) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    try {
      await onSubmit?.({
        email: String(fd.get("email") ?? ""),
        password: String(fd.get("password") ?? ""),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-left">
          <DialogTitle>Welcome back</DialogTitle>
          <DialogDescription>Sign in to continue to your workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="si-email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="si-email" name="email" type="email" placeholder="you@company.com" className="pl-9" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="si-password">Password</Label>
              <button type="button" onClick={onForgotPassword} className="text-xs text-muted-foreground hover:text-foreground">
                Forgot?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="si-password" name="password" type="password" placeholder="••••••••" className="pl-9" required />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button type="button" variant="outline" className="w-full">Continue with Google</Button>
        </form>
        <DialogFooter className="sm:justify-center">
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <button type="button" onClick={onSwitchToSignUp} className="font-medium text-foreground hover:underline">
              Create an account
            </button>
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
`;

const AUTH_PASSWORD_RESET_SHEET = `import { useState, type FormEvent } from "react";
import { Loader2, MailCheck, KeyRound } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Side-sheet password reset. Sheet is preferred over Dialog when the
 * action is secondary (slides in from the side without dimming the
 * primary auth modal behind it on desktop).
 *
 * Two-state UI: form → success confirmation. Reset to the form by
 * closing and reopening.
 */
export interface PasswordResetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (email: string) => void | Promise<void>;
  side?: "left" | "right" | "top" | "bottom";
}

export default function PasswordResetSheet({ open, onOpenChange, onSubmit, side = "right" }: PasswordResetSheetProps) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setLoading(true);
    try {
      await onSubmit?.(email);
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // reset to form view next time the sheet opens
      setTimeout(() => setSent(false), 200);
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side={side} className="sm:max-w-md">
        <SheetHeader>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <SheetTitle>Reset your password</SheetTitle>
          <SheetDescription>
            Enter the email associated with your account and we'll send you a link to choose a new password.
          </SheetDescription>
        </SheetHeader>

        {sent ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="font-medium text-foreground">Check your inbox</p>
              <p className="mt-1 text-xs text-muted-foreground">
                If an account exists for that email, a reset link is on its way.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-email">Email</Label>
              <Input id="pr-email" name="email" type="email" placeholder="you@company.com" required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send reset link
            </Button>
          </form>
        )}

        <SheetFooter className="mt-6">
          <Button type="button" variant="ghost" className="w-full" onClick={() => handleOpenChange(false)}>
            Back to sign in
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
`;

const AUTH_MAGIC_LINK_DIALOG = `import { useState, type FormEvent } from "react";
import { Loader2, Mail, Sparkles, MailCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Modal magic-link / passwordless auth. Single email field → success state.
 * Use as the primary auth surface for apps that prefer passwordless flows.
 */
export interface MagicLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: (email: string) => void | Promise<void>;
  onUsePassword?: () => void;
}

export default function MagicLinkDialog({ open, onOpenChange, onSubmit, onUsePassword }: MagicLinkDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    setLoading(true);
    try {
      await onSubmit?.(email);
      setSentTo(email);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setTimeout(() => setSentTo(null), 200);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-left">
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <DialogTitle>Sign in with a magic link</DialogTitle>
          <DialogDescription>
            No password needed. We'll email you a link that signs you in instantly.
          </DialogDescription>
        </DialogHeader>

        {sentTo ? (
          <div className="mt-2 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="font-medium text-foreground">Magic link sent</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the link we just sent to <span className="font-medium text-foreground">{sentTo}</span> to finish signing in. You can close this window.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ml-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="ml-email" name="email" type="email" placeholder="you@company.com" className="pl-9" required />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send magic link
            </Button>
          </form>
        )}

        <DialogFooter className="sm:justify-center">
          <button type="button" onClick={onUsePassword} className="text-sm text-muted-foreground hover:text-foreground">
            Sign in with a password instead
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
`;

/* =================================================================
 * DASHBOARD WIDGETS (7) — combinable building blocks
 *
 * Smaller, prop-driven atoms designed to be composed into full pages.
 * Unlike the \`dashboard-*.tsx\` blocks (which are opinionated full
 * sections), these accept data via props and render in any layout.
 *
 * Charts are pure SVG placeholders so they work in every generated app
 * without needing a chart library. When the user wires real data, swap
 * the SVG body for recharts/visx — the surrounding Card stays the same.
 * ================================================================= */

const WIDGET_KPI_CARD = `import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComponentType } from "react";

/**
 * Single KPI tile — the atom of \`dashboard-stats-grid\`. Compose 2/3/4-up
 * with a parent grid: \`<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">\`.
 */
export interface KpiCardProps {
  label: string;
  value: string;
  /** Percent change vs previous period. Positive = good. Pass null to hide. */
  delta?: number | null;
  /** Helper line under the delta, e.g. "vs last week". */
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
}

export default function KpiCard({ label, value, delta = null, hint = "vs last period", icon: Icon }: KpiCardProps) {
  const positive = (delta ?? 0) >= 0;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {delta !== null && (
          <p className={\`mt-1 inline-flex items-center gap-1 text-xs \${positive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}\`}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta)}% {hint}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
`;

const WIDGET_FILTER_BAR = `import { CalendarRange, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Reusable filter toolbar for any list/table/dashboard page.
 * Search + segment + date range + secondary actions, fully responsive.
 */
export interface FilterBarProps {
  ranges?: string[];
  segments?: string[];
  defaultRange?: string;
  defaultSegment?: string;
  onSearch?: (q: string) => void;
  onRangeChange?: (range: string) => void;
  onSegmentChange?: (segment: string) => void;
}

export default function FilterBar({
  ranges = ["Today", "7 days", "30 days", "90 days", "Custom"],
  segments = ["All", "Active", "Trialing", "Cancelled"],
  defaultRange = "7 days",
  defaultSegment = "All",
  onSearch,
  onRangeChange,
  onSegmentChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search…" className="pl-9" onChange={(e) => onSearch?.(e.target.value)} />
        </div>
        <Tabs defaultValue={defaultSegment} onValueChange={onSegmentChange} className="hidden md:block">
          <TabsList>
            {segments.map((s) => (
              <TabsTrigger key={s} value={s}>{s}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex items-center gap-2">
        <Select defaultValue={defaultRange} onValueChange={onRangeChange}>
          <SelectTrigger className="w-[150px]">
            <CalendarRange className="mr-2 h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ranges.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" aria-label="More filters">
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
`;

const WIDGET_CHART_AREA = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Area-chart placeholder. Pure SVG so it runs without a chart library.
 * Swap the path for a real chart (recharts \`<AreaChart>\`) when wiring data.
 */
export interface AreaChartCardProps {
  title?: string;
  description?: string;
  total?: string;
  delta?: string;
  /** Series of normalized values 0..1; defaults to a sample series. */
  series?: number[];
}

const SAMPLE = [0.2, 0.45, 0.3, 0.6, 0.5, 0.75, 0.6, 0.85, 0.7, 0.95];

export default function AreaChartCard({
  title = "Revenue",
  description = "Last 30 days",
  total = "$48,294",
  delta = "+12.4%",
  series = SAMPLE,
}: AreaChartCardProps) {
  const w = 320, h = 96;
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => \`\${i * step},\${h - v * (h - 6) - 3}\`);
  const linePath = "M " + pts.join(" L ");
  const areaPath = \`\${linePath} L \${w},\${h} L 0,\${h} Z\`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-semibold tracking-tight">{total}</div>
          <span className="text-xs text-emerald-600 dark:text-emerald-400">{delta}</span>
        </div>
        <svg viewBox={\`0 0 \${w} \${h}\`} className="mt-4 h-24 w-full">
          <defs>
            <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#area-fill)" />
          <path d={linePath} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </CardContent>
    </Card>
  );
}
`;

const WIDGET_CHART_BAR = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Bar-chart placeholder. Pure SVG; pass any series of \`{ label, value }\`.
 */
export interface BarChartCardProps {
  title?: string;
  description?: string;
  data?: Array<{ label: string; value: number }>;
}

const SAMPLE = [
  { label: "Mon", value: 32 },
  { label: "Tue", value: 48 },
  { label: "Wed", value: 24 },
  { label: "Thu", value: 64 },
  { label: "Fri", value: 56 },
  { label: "Sat", value: 80 },
  { label: "Sun", value: 44 },
];

export default function BarChartCard({
  title = "Sessions by day",
  description = "This week",
  data = SAMPLE,
}: BarChartCardProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 320, h = 120, gap = 6;
  const barW = (w - gap * (data.length - 1)) / data.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <svg viewBox={\`0 0 \${w} \${h + 20}\`} className="h-36 w-full">
          {data.map((d, i) => {
            const bh = (d.value / max) * h;
            const x = i * (barW + gap);
            return (
              <g key={d.label}>
                <rect x={x} y={h - bh} width={barW} height={bh} rx="3" fill="hsl(var(--primary))" opacity={0.85} />
                <text x={x + barW / 2} y={h + 14} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}
`;

const WIDGET_CHART_DONUT = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Donut-chart placeholder. Pure SVG; renders proportional arcs and a legend.
 * Slice colours cycle through chart tokens (chart-1..chart-5) — define them
 * in your design tokens or fall back to primary/muted shades.
 */
export interface DonutChartCardProps {
  title?: string;
  description?: string;
  data?: Array<{ label: string; value: number }>;
}

const SAMPLE = [
  { label: "Direct", value: 42 },
  { label: "Search", value: 28 },
  { label: "Social", value: 18 },
  { label: "Referral", value: 12 },
];

const COLORS = ["hsl(var(--primary))", "hsl(var(--primary)/0.7)", "hsl(var(--primary)/0.45)", "hsl(var(--primary)/0.25)"];

export default function DonutChartCard({
  title = "Traffic sources",
  description = "Last 7 days",
  data = SAMPLE,
}: DonutChartCardProps) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 60, cy = 60, r = 48, stroke = 18;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-6">
        <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
          {data.map((d, i) => {
            const len = (d.value / total) * C;
            const dash = \`\${len} \${C - len}\`;
            const el = (
              <circle
                key={d.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <ul className="flex-1 space-y-2 text-sm">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="text-foreground">{d.label}</span>
              </span>
              <span className="text-muted-foreground">{Math.round((d.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
`;

const WIDGET_ACTIVITY_LOG = `import { GitCommit, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComponentType } from "react";

/**
 * Compact, log-style activity widget — denser than \`dashboard-activity-feed\`.
 * Use in narrow sidebars or alongside charts. Pass your own events via props.
 */
export type LogLevel = "info" | "success" | "warn" | "commit";

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** Pre-formatted relative time, e.g. "2m", "1h". */
  when: string;
  source?: string;
}

const ICONS: Record<LogLevel, ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  commit: GitCommit,
};

const TONES: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  commit: "text-primary",
};

const SAMPLE: LogEntry[] = [
  { level: "success", message: "Deploy succeeded on main", when: "2m", source: "ci" },
  { level: "commit", message: "feat: add filter toolbar", when: "12m", source: "github" },
  { level: "warn", message: "API latency above 800ms", when: "1h", source: "monitor" },
  { level: "info", message: "3 new sign-ups today", when: "3h", source: "billing" },
];

export interface ActivityLogProps {
  title?: string;
  entries?: LogEntry[];
}

export default function ActivityLog({ title = "Activity", entries = SAMPLE }: ActivityLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {entries.map((e, i) => {
            const Icon = ICONS[e.level];
            return (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <Icon className={\`mt-0.5 h-4 w-4 shrink-0 \${TONES[e.level]}\`} />
                <div className="flex-1">
                  <p className="text-foreground">{e.message}</p>
                  {e.source && <p className="text-xs text-muted-foreground">{e.source}</p>}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">{e.when}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
`;

const WIDGET_TABLE_SORTABLE = `import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Sortable + selectable data-table widget. Generic over the row type;
 * pass a column config that maps each column to a key + header label,
 * and the table handles sort state and row selection internally.
 *
 * For really large datasets, swap the in-memory \`useMemo\` sort for a
 * server-side query and lift selection state to the parent.
 */
export interface ColumnDef<T> {
  key: keyof T & string;
  header: string;
  /** Optional cell renderer (defaults to String(row[key])). */
  cell?: (row: T) => React.ReactNode;
  /** If false, this column won't be sortable. Defaults to true. */
  sortable?: boolean;
  align?: "left" | "right";
}

export interface SortableTableProps<T extends { id: string | number }> {
  rows: T[];
  columns: ColumnDef<T>[];
  selectable?: boolean;
}

type SortState<T> = { key: keyof T & string; dir: "asc" | "desc" } | null;

export default function SortableTable<T extends { id: string | number }>({
  rows,
  columns,
  selectable = true,
}: SortableTableProps<T>) {
  const [sort, setSort] = useState<SortState<T>>(null);
  const [selected, setSelected] = useState<Set<T["id"]>>(new Set());

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av === bv) return 0;
      const r = av > bv ? 1 : -1;
      return dir === "asc" ? r : -r;
    });
  }, [rows, sort]);

  function toggleSort(col: ColumnDef<T>) {
    if (col.sortable === false) return;
    setSort((s) =>
      !s || s.key !== col.key ? { key: col.key, dir: "asc" } :
      s.dir === "asc" ? { key: col.key, dir: "desc" } : null
    );
  }

  const allChecked = selectable && selected.size > 0 && selected.size === rows.length;

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                  aria-label="Select all"
                />
              </TableHead>
            )}
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <TableHead key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                  <button
                    type="button"
                    onClick={() => toggleSort(c)}
                    disabled={c.sortable === false}
                    className="inline-flex items-center gap-1 font-medium hover:text-foreground disabled:cursor-default disabled:opacity-100"
                  >
                    {c.header}
                    {c.sortable !== false && <Icon className="h-3 w-3 opacity-60" />}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const isSelected = selected.has(row.id);
            return (
              <TableRow key={String(row.id)} data-state={isSelected ? "selected" : undefined}>
                {selectable && (
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(row.id); else next.delete(row.id);
                        setSelected(next);
                      }}
                      aria-label={\`Select row \${row.id}\`}
                    />
                  </TableCell>
                )}
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.align === "right" ? "text-right" : undefined}>
                    {c.cell ? c.cell(row) : String(row[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {selectable && selected.size > 0 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
          <span className="text-muted-foreground">{selected.size} selected</span>
          <Badge variant="secondary">Bulk actions →</Badge>
        </div>
      )}
    </Card>
  );
}

// Example usage (delete in production):
// const cols: ColumnDef<{id: number; name: string; mrr: number}>[] = [
//   { key: "name", header: "Customer" },
//   { key: "mrr", header: "MRR", align: "right", cell: (r) => \`$\${r.mrr}\` },
// ];
// <SortableTable rows={data} columns={cols} />
`;

/* =================================================================
 * VARIANTS — forms & tables (3)
 * ================================================================= */

const TABLE_INLINE_EDIT = `import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * InlineEditTable — click the pencil to edit a row in place.
 * Each row toggles between read and edit mode; Save/Cancel commit or revert.
 * Pure presentational reference: swap \`useState\` for your data layer.
 */
type Row = { id: string; name: string; email: string; role: string };

const SEED: Row[] = [
  { id: "1", name: "Ava Stone", email: "ava@acme.dev", role: "Admin" },
  { id: "2", name: "Ben Liu", email: "ben@acme.dev", role: "Editor" },
  { id: "3", name: "Cara Vex", email: "cara@acme.dev", role: "Viewer" },
];

export default function InlineEditTable() {
  const [rows, setRows] = useState<Row[]>(SEED);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Row | null>(null);

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setDraft({ ...row });
  };
  const cancel = () => {
    setEditingId(null);
    setDraft(null);
  };
  const save = () => {
    if (!draft) return;
    setRows((rs) => rs.map((r) => (r.id === draft.id ? draft : r)));
    cancel();
  };

  return (
    <div className="rounded-lg border border-border bg-card">
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
          {rows.map((row) => {
            const isEditing = editingId === row.id && draft;
            return (
              <TableRow key={row.id}>
                <TableCell>
                  {isEditing ? (
                    <Input
                      value={draft!.name}
                      onChange={(e) => setDraft({ ...draft!, name: e.target.value })}
                      className="h-8"
                    />
                  ) : (
                    <span className="font-medium">{row.name}</span>
                  )}
                </TableCell>
                <TableCell>
                  {isEditing ? (
                    <Input
                      type="email"
                      value={draft!.email}
                      onChange={(e) => setDraft({ ...draft!, email: e.target.value })}
                      className="h-8"
                    />
                  ) : (
                    <span className="text-muted-foreground">{row.email}</span>
                  )}
                </TableCell>
                <TableCell>
                  {isEditing ? (
                    <Input
                      value={draft!.role}
                      onChange={(e) => setDraft({ ...draft!, role: e.target.value })}
                      className="h-8"
                    />
                  ) : (
                    row.role
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={save} aria-label="Save">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={cancel} aria-label="Cancel">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button size="icon" variant="ghost" onClick={() => startEdit(row)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
`;

const TABLE_DESTRUCTIVE_CONFIRM = `import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * DestructiveConfirmTable — irreversible delete with type-to-confirm guard.
 * Use for "delete project", "remove member", "drop database" actions.
 * The confirm button stays disabled until the user types the exact target name.
 */
type Item = { id: string; name: string; owner: string };

const SEED: Item[] = [
  { id: "p1", name: "marketing-site", owner: "Ava" },
  { id: "p2", name: "internal-tools", owner: "Ben" },
  { id: "p3", name: "petal-prod", owner: "Cara" },
];

export default function DestructiveConfirmTable() {
  const [items, setItems] = useState<Item[]>(SEED);
  const [target, setTarget] = useState<Item | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const open = (item: Item) => {
    setTarget(item);
    setConfirmText("");
  };
  const close = () => {
    setTarget(null);
    setConfirmText("");
  };
  const confirm = () => {
    if (!target) return;
    setItems((xs) => xs.filter((x) => x.id !== target.id));
    close();
  };

  const matches = target !== null && confirmText === target.name;

  return (
    <>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-muted-foreground">{item.owner}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => open(item)}
                    aria-label={\`Delete \${item.name}\`}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={target !== null} onOpenChange={(v) => !v && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <AlertDialogTitle>Delete {target?.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. All data, history, and integrations
                  for this project will be permanently removed.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm">
              Type <span className="font-mono font-semibold text-foreground">{target?.name}</span> to confirm
            </Label>
            <Input
              id="confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={target?.name ?? ""}
              autoComplete="off"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirm}
              disabled={!matches}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
`;

const FORM_MULTI_STEP_ERROR = `import { useState } from "react";
import { ArrowLeft, ArrowRight, AlertCircle, Check, Loader2, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

/**
 * MultiStepFormErrorState — three-step wizard with submit-time failure handling.
 * Demonstrates: per-step field errors, blocking inline alert on submit failure,
 * retry without losing data, and a recovery path back to a previous step.
 */
type Step = 0 | 1 | 2;
type Data = { name: string; email: string; company: string; team: string; plan: string };

const STEPS = ["Account", "Workspace", "Plan"] as const;
const EMPTY: Data = { name: "", email: "", company: "", team: "", plan: "" };

export default function MultiStepFormErrorState() {
  const [step, setStep] = useState<Step>(0);
  const [data, setData] = useState<Data>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Data, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ title: string; detail: string; recoverStep?: Step } | null>(null);
  const [done, setDone] = useState(false);

  const set = <K extends keyof Data>(k: K, v: Data[K]) => {
    setData((d) => ({ ...d, [k]: v }));
    if (fieldErrors[k]) setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  const validateStep = (s: Step): boolean => {
    const errs: Partial<Record<keyof Data, string>> = {};
    if (s === 0) {
      if (!data.name.trim()) errs.name = "Name is required";
      if (!/^\\S+@\\S+\\.\\S+$/.test(data.email)) errs.email = "Enter a valid email";
    } else if (s === 1) {
      if (!data.company.trim()) errs.company = "Company is required";
      if (!data.team.trim()) errs.team = "Team name is required";
    } else if (s === 2) {
      if (!data.plan) errs.plan = "Pick a plan to continue";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(2, s + 1) as Step);
  };
  const back = () => {
    setSubmitError(null);
    setStep((s) => Math.max(0, s - 1) as Step);
  };

  const submit = async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Simulated failure — swap for your real call.
      await new Promise((_, reject) =>
        setTimeout(() => reject(new Error("EMAIL_TAKEN")), 800),
      );
      setDone(true);
    } catch (err) {
      const code = err instanceof Error ? err.message : "UNKNOWN";
      if (code === "EMAIL_TAKEN") {
        setSubmitError({
          title: "That email is already in use",
          detail: "An account with this email already exists. Go back to step 1 to use a different one, or sign in instead.",
          recoverStep: 0,
        });
      } else {
        setSubmitError({
          title: "We couldn't create your workspace",
          detail: "Something went wrong on our end. Your details are safe — please try again.",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader className="items-center text-center">
          <div className="mb-3 rounded-full bg-primary/10 p-3 text-primary">
            <Check className="h-6 w-6" />
          </div>
          <CardTitle>Workspace ready</CardTitle>
          <CardDescription>You're all set, {data.name.split(" ")[0] || "there"}.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {step + 1} of {STEPS.length}</span>
          <span>{STEPS[step]}</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
        <CardTitle className="mt-4">{STEPS[step]}</CardTitle>
        <CardDescription>
          {step === 0 && "Tell us who you are."}
          {step === 1 && "Set up your workspace."}
          {step === 2 && "Pick a plan to finish."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {submitError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{submitError.title}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{submitError.detail}</p>
              <div className="flex gap-2">
                {submitError.recoverStep !== undefined && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setStep(submitError.recoverStep!);
                      setSubmitError(null);
                    }}
                  >
                    <ArrowLeft className="mr-1 h-3 w-3" />
                    Back to {STEPS[submitError.recoverStep]}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={submit} disabled={submitting}>
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Try again
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {step === 0 && (
          <>
            <Field label="Full name" id="name" error={fieldErrors.name}>
              <Input id="name" value={data.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Work email" id="email" error={fieldErrors.email}>
              <Input id="email" type="email" value={data.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Company" id="company" error={fieldErrors.company}>
              <Input id="company" value={data.company} onChange={(e) => set("company", e.target.value)} />
            </Field>
            <Field label="Team name" id="team" error={fieldErrors.team}>
              <Input id="team" value={data.team} onChange={(e) => set("team", e.target.value)} />
            </Field>
          </>
        )}
        {step === 2 && (
          <Field label="Plan" id="plan" error={fieldErrors.plan}>
            <div className="grid grid-cols-2 gap-2">
              {(["Starter", "Pro"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set("plan", p)}
                  className={
                    "rounded-md border p-3 text-left text-sm transition-colors " +
                    (data.plan === p
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent")
                  }
                >
                  <div className="font-medium">{p}</div>
                  <div className="text-xs text-muted-foreground">
                    {p === "Starter" ? "Free for 14 days" : "$19/mo per seat"}
                  </div>
                </button>
              ))}
            </div>
          </Field>
        )}
      </CardContent>

      <CardFooter className="justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || submitting}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {step < 2 ? (
          <Button onClick={next}>
            Continue <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? "Creating..." : "Finish"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
`;

/* =================================================================
 * PHASE 3 — KIT EXPANSION DEMOS
 * Search palette, validated form, sales chart card. Each shows the
 * canonical wiring of the new kit components.
 * ================================================================= */

const KIT_COMMAND_PALETTE = `import { useEffect, useState } from "react";
import { Calendar, FileText, Settings, User } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";

/**
 * Cmd/Ctrl+K command palette. Drop this anywhere in your app and the
 * keyboard shortcut works globally. Adapt the items to match your routes.
 */
export default function CommandPaletteExample() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Search...
        <CommandShortcut>⌘K</CommandShortcut>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem onSelect={() => setOpen(false)}>
              <Calendar className="mr-2 h-4 w-4" />
              Calendar
            </CommandItem>
            <CommandItem onSelect={() => setOpen(false)}>
              <FileText className="mr-2 h-4 w-4" />
              New document
              <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Account">
            <CommandItem onSelect={() => setOpen(false)}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </CommandItem>
            <CommandItem onSelect={() => setOpen(false)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
              <CommandShortcut>⌘,</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
`;

const KIT_VALIDATED_FORM = `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormField, useForm } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * Account-creation form using useForm + FormField + Combobox + DatePicker.
 * Replace the validate body with zod or yup once you outgrow inline rules.
 */
const ROLES = [
  { label: "Engineer", value: "engineer" },
  { label: "Designer", value: "designer" },
  { label: "Product Manager", value: "pm" },
  { label: "Founder / CEO", value: "founder" },
];

export default function ValidatedFormExample() {
  const form = useForm({
    defaults: { name: "", email: "", role: "", startDate: undefined as Date | undefined, bio: "" },
    validate: (v) => ({
      name: v.name.trim().length < 2 ? "Name must be at least 2 characters" : undefined,
      email: !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v.email) ? "Enter a valid email" : undefined,
      role: !v.role ? "Pick a role" : undefined,
      startDate: !v.startDate ? "Pick a start date" : undefined,
      bio: v.bio.length > 280 ? "Keep it under 280 characters" : undefined,
    }),
    onSubmit: async (v) => {
      await new Promise((r) => setTimeout(r, 600));
      toast.success(\`Welcome, \${v.name}!\`);
      form.reset();
    },
  });

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Tell us a bit about yourself to get started.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={form.handleSubmit}>
          <FormField name="name" label="Full name" error={form.touched.name ? form.errors.name : undefined}>
            <Input id="name" {...form.register("name")} placeholder="Ada Lovelace" />
          </FormField>
          <FormField name="email" label="Email" error={form.touched.email ? form.errors.email : undefined}>
            <Input id="email" type="email" {...form.register("email")} placeholder="ada@example.com" />
          </FormField>
          <FormField name="role" label="Role" error={form.touched.role ? form.errors.role : undefined}>
            <Combobox
              options={ROLES}
              value={form.values.role}
              onChange={(v) => form.setValue("role", v)}
              placeholder="Select a role"
              className="w-full"
            />
          </FormField>
          <FormField name="startDate" label="Start date" error={form.touched.startDate ? form.errors.startDate : undefined}>
            <DatePicker
              value={form.values.startDate}
              onChange={(d) => form.setValue("startDate", d)}
              className="w-full"
            />
          </FormField>
          <FormField name="bio" label="Short bio" description="Optional. 280 characters max." error={form.errors.bio}>
            <Textarea id="bio" {...form.register("bio")} placeholder="What do you build?" />
          </FormField>
          <Button type="submit" className="w-full" disabled={form.submitting}>
            {form.submitting ? "Creating..." : "Create account"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
`;

const KIT_SALES_CHART_CARD = `import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, BarChart, LineChart } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Revenue chart card with range tabs and three chart variants. Drop into
 * any dashboard. Swap \`DATA\` with your real time-series.
 */
const DATA = [
  { x: "Jan", y: 4200 },
  { x: "Feb", y: 5100 },
  { x: "Mar", y: 4800 },
  { x: "Apr", y: 6300 },
  { x: "May", y: 7100 },
  { x: "Jun", y: 6800 },
  { x: "Jul", y: 8400 },
];

export default function SalesChartCardExample() {
  const [variant, setVariant] = useState<"line" | "area" | "bar">("area");
  const total = DATA.reduce((s, d) => s + d.y, 0);
  const last = DATA[DATA.length - 1].y;
  const prev = DATA[DATA.length - 2].y;
  const delta = ((last - prev) / prev) * 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Revenue</CardTitle>
            <CardDescription>Last 7 months</CardDescription>
          </div>
          <Tabs value={variant} onValueChange={(v) => setVariant(v as typeof variant)}>
            <TabsList>
              <TabsTrigger value="area">Area</TabsTrigger>
              <TabsTrigger value="line">Line</TabsTrigger>
              <TabsTrigger value="bar">Bar</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <div className="text-3xl font-semibold tabular-nums">\${total.toLocaleString()}</div>
          <div className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <TrendingUp className="h-3 w-3" />
            {delta.toFixed(1)}% vs last month
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {variant === "area" && <AreaChart data={DATA} className="h-56" />}
        {variant === "line" && <LineChart data={DATA} className="h-56" />}
        {variant === "bar" && <BarChart data={DATA} className="h-56" />}
      </CardContent>
    </Card>
  );
}
`;

/* =================================================================
 * INDEX MARKDOWN
 * ================================================================= */

const EXAMPLES_INDEX = `# Examples pack — copy-from reference patterns

These files are NOT imported by App.tsx. They exist purely as a high-quality
source of patterns the AI can read and adapt. When the user asks for a
"sign-in screen", "pricing page", "team members table", etc., open the
matching file below and adapt — do not invent layouts from scratch.

## Auth
- \`auth-sign-in-card.tsx\` — centered sign-in with email/password + OAuth
- \`auth-sign-up-split.tsx\` — split-screen onboarding (brand left, form right)
- \`auth-forgot-password.tsx\` — reset request form (calls \`resetPasswordForEmail\`)
- \`auth-reset-password.tsx\` — landing page for the reset link (calls \`updatePassword\`); mount at \`/reset-password\`
- \`auth-otp-card.tsx\` — six-digit code verification

## Auth modals (Dialog / Sheet)
- \`auth-sign-up-dialog.tsx\` — modal sign-up (controlled, OAuth + switch to sign-in)
- \`auth-sign-in-dialog.tsx\` — modal sign-in (controlled, hooks for forgot/sign-up)
- \`auth-password-reset-sheet.tsx\` — side-sheet password reset with success state
- \`auth-magic-link-dialog.tsx\` — passwordless modal with magic-link success state

## Onboarding flow (composed from auth blocks)
- \`onboarding-welcome.tsx\` — hero/welcome screen with primary + secondary CTAs
- \`onboarding-signup-step.tsx\` — name + email + password step (calls \`onSubmit\`)
- \`onboarding-verify-step.tsx\` — six-digit OTP step bound to the signup email
- \`onboarding-success.tsx\` — final "you're all set" screen
- \`onboarding-flow.tsx\` — orchestrator wiring welcome → signup → verify → done, with forgot-password side route

## Dashboard
- \`dashboard-stats-grid.tsx\` — four-up KPI cards with delta indicators
- \`dashboard-sidebar-layout.tsx\` — persistent left rail + top bar shell
- \`dashboard-chart-card.tsx\` — analytics card with range tabs + sparkline
- \`dashboard-activity-feed.tsx\` — vertical timeline of team events
- \`dashboard-empty-state.tsx\` — friendly empty list/table block

## Dashboard widgets (combinable atoms)
- \`widget-kpi-card.tsx\` — single KPI tile, prop-driven (label/value/delta/icon)
- \`widget-filter-bar.tsx\` — search + segment tabs + date range + actions toolbar
- \`widget-chart-area.tsx\` — area-chart card placeholder (pure SVG, swap for recharts)
- \`widget-chart-bar.tsx\` — bar-chart card placeholder (pure SVG)
- \`widget-chart-donut.tsx\` — donut chart with inline legend (pure SVG)
- \`widget-activity-log.tsx\` — compact log-style feed (info/success/warn/commit)
- \`widget-table-sortable.tsx\` — generic sortable + selectable data table

## Pricing
- \`pricing-three-tier.tsx\` — three-plan grid with featured tier
- \`pricing-toggle-billing.tsx\` — monthly / annual toggle
- \`pricing-comparison-table.tsx\` — side-by-side feature matrix

## Hero
- \`hero-centered-gradient.tsx\` — centered marketing hero with gradient
- \`hero-split-screenshot.tsx\` — copy left, product mock right
- \`hero-logo-cloud.tsx\` — social-proof logo strip
- \`hero-feature-band.tsx\` — four-up feature row below the hero

## Forms
- \`form-profile-settings.tsx\` — avatar + name + bio settings card
- \`form-multi-step.tsx\` — three-step onboarding wizard with progress
- \`form-contact.tsx\` — public contact form with reason select
- \`form-inline-validation.tsx\` — live password-strength meter

## Tables
- \`table-users-list.tsx\` — team table with avatar, role badge, actions menu
- \`table-invoices.tsx\` — billing history with status badges + download
- \`table-filter-toolbar.tsx\` — search + status filter + primary CTA above
- \`table-paginated.tsx\` — sortable header + pagination footer

## Variants — forms & tables
- \`table-inline-edit.tsx\` — click-to-edit row with Save/Cancel controls
- \`table-destructive-confirm.tsx\` — delete row with type-to-confirm AlertDialog guard
- \`form-multi-step-error.tsx\` — wizard with submit failure: inline alert, retry, recover-to-step

## Conventions

- Every example uses semantic tokens only — no raw hex, no Tailwind colour names.
- Every example is self-contained: one default export, no router, no fetching.
- When adapting, keep the structure but rename, restyle copy, and wire data.
- Never import these files from App.tsx or routes — they are reference-only.
`;

/* =================================================================
 * EXPORTED LIST
 * ================================================================= */

export const EXAMPLES_PACK: Array<ProjectFile & { overwrite: boolean }> = [
  { path: "src/components/examples/EXAMPLES.md", content: EXAMPLES_INDEX, overwrite: true },

  // Auth
  { path: "src/components/examples/auth-sign-in-card.tsx", content: AUTH_SIGN_IN_CARD, overwrite: true },
  { path: "src/components/examples/auth-sign-up-split.tsx", content: AUTH_SIGN_UP_SPLIT, overwrite: true },
  { path: "src/components/examples/auth-forgot-password.tsx", content: AUTH_FORGOT_PASSWORD, overwrite: true },
  { path: "src/components/examples/auth-reset-password.tsx", content: AUTH_RESET_PASSWORD, overwrite: true },
  { path: "src/components/examples/auth-otp-card.tsx", content: AUTH_OTP_CARD, overwrite: true },

  // Auth modals (Dialog / Sheet)
  { path: "src/components/examples/auth-sign-up-dialog.tsx", content: AUTH_SIGN_UP_DIALOG, overwrite: true },
  { path: "src/components/examples/auth-sign-in-dialog.tsx", content: AUTH_SIGN_IN_DIALOG, overwrite: true },
  { path: "src/components/examples/auth-password-reset-sheet.tsx", content: AUTH_PASSWORD_RESET_SHEET, overwrite: true },
  { path: "src/components/examples/auth-magic-link-dialog.tsx", content: AUTH_MAGIC_LINK_DIALOG, overwrite: true },

  // Onboarding flow
  { path: "src/components/examples/onboarding-welcome.tsx", content: ONBOARDING_WELCOME, overwrite: true },
  { path: "src/components/examples/onboarding-signup-step.tsx", content: ONBOARDING_SIGNUP_STEP, overwrite: true },
  { path: "src/components/examples/onboarding-verify-step.tsx", content: ONBOARDING_VERIFY_STEP, overwrite: true },
  { path: "src/components/examples/onboarding-success.tsx", content: ONBOARDING_SUCCESS, overwrite: true },
  { path: "src/components/examples/onboarding-flow.tsx", content: ONBOARDING_FLOW, overwrite: true },

  // Dashboard
  { path: "src/components/examples/dashboard-stats-grid.tsx", content: DASHBOARD_STATS_GRID, overwrite: true },
  { path: "src/components/examples/dashboard-sidebar-layout.tsx", content: DASHBOARD_SIDEBAR_LAYOUT, overwrite: true },
  { path: "src/components/examples/dashboard-chart-card.tsx", content: DASHBOARD_CHART_CARD, overwrite: true },
  { path: "src/components/examples/dashboard-activity-feed.tsx", content: DASHBOARD_ACTIVITY_FEED, overwrite: true },
  { path: "src/components/examples/dashboard-empty-state.tsx", content: DASHBOARD_EMPTY_STATE, overwrite: true },

  // Dashboard widgets (combinable atoms)
  { path: "src/components/examples/widget-kpi-card.tsx", content: WIDGET_KPI_CARD, overwrite: true },
  { path: "src/components/examples/widget-filter-bar.tsx", content: WIDGET_FILTER_BAR, overwrite: true },
  { path: "src/components/examples/widget-chart-area.tsx", content: WIDGET_CHART_AREA, overwrite: true },
  { path: "src/components/examples/widget-chart-bar.tsx", content: WIDGET_CHART_BAR, overwrite: true },
  { path: "src/components/examples/widget-chart-donut.tsx", content: WIDGET_CHART_DONUT, overwrite: true },
  { path: "src/components/examples/widget-activity-log.tsx", content: WIDGET_ACTIVITY_LOG, overwrite: true },
  { path: "src/components/examples/widget-table-sortable.tsx", content: WIDGET_TABLE_SORTABLE, overwrite: true },

  // Pricing
  { path: "src/components/examples/pricing-three-tier.tsx", content: PRICING_THREE_TIER, overwrite: true },
  { path: "src/components/examples/pricing-toggle-billing.tsx", content: PRICING_TOGGLE_BILLING, overwrite: true },
  { path: "src/components/examples/pricing-comparison-table.tsx", content: PRICING_COMPARISON_TABLE, overwrite: true },

  // Hero
  { path: "src/components/examples/hero-centered-gradient.tsx", content: HERO_CENTERED_GRADIENT, overwrite: true },
  { path: "src/components/examples/hero-split-screenshot.tsx", content: HERO_SPLIT_SCREENSHOT, overwrite: true },
  { path: "src/components/examples/hero-logo-cloud.tsx", content: HERO_LOGO_CLOUD, overwrite: true },
  { path: "src/components/examples/hero-feature-band.tsx", content: HERO_FEATURE_BAND, overwrite: true },

  // Forms
  { path: "src/components/examples/form-profile-settings.tsx", content: FORM_PROFILE_SETTINGS, overwrite: true },
  { path: "src/components/examples/form-multi-step.tsx", content: FORM_MULTI_STEP, overwrite: true },
  { path: "src/components/examples/form-contact.tsx", content: FORM_CONTACT, overwrite: true },
  { path: "src/components/examples/form-inline-validation.tsx", content: FORM_INLINE_VALIDATION, overwrite: true },

  // Tables
  { path: "src/components/examples/table-users-list.tsx", content: TABLE_USERS_LIST, overwrite: true },
  { path: "src/components/examples/table-invoices.tsx", content: TABLE_INVOICES, overwrite: true },
  { path: "src/components/examples/table-filter-toolbar.tsx", content: TABLE_FILTER_TOOLBAR, overwrite: true },
  { path: "src/components/examples/table-paginated.tsx", content: TABLE_PAGINATED, overwrite: true },

  // Variants — forms & tables
  { path: "src/components/examples/table-inline-edit.tsx", content: TABLE_INLINE_EDIT, overwrite: true },
  { path: "src/components/examples/table-destructive-confirm.tsx", content: TABLE_DESTRUCTIVE_CONFIRM, overwrite: true },
  { path: "src/components/examples/form-multi-step-error.tsx", content: FORM_MULTI_STEP_ERROR, overwrite: true },
];
