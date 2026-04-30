/**
 * Dynamic system-prompt snippets (Tier 2 reliability).
 *
 * The base SYSTEM_PROMPT_INITIAL / SYSTEM_PROMPT_PATCH stays small. We
 * APPEND topic-specific reinforcement blocks that include the actual kit
 * component signatures the model needs for *this* turn — instead of
 * shoving all 50 components into every prompt. This keeps prompt size
 * down, raises adherence (rules buried under 200 lines get ignored),
 * and lets us pin version-specific snippets without bloating every call.
 *
 * Strategy: keyword-match the latest user turn (+ recent history), and
 * append concise reinforcement blocks for matched topics. Cap at a
 * generous N matches (most topics are independent) but always include
 * the "kit-core" baseline so the model knows the always-needed
 * primitives (Button/Card/Input/etc.) on every turn.
 */

export type DynamicSnippetKey =
  | "kitCore"
  | "fileBudget"
  | "charts"
  | "forms"
  | "datetime"
  | "tables"
  | "router"
  | "auth"
  | "noBackendGate"
  | "images"
  | "tailwindv4"
  | "toast"
  | "layout"
  | "overlays"
  | "navigation"
  | "feedback";

interface SnippetDef {
  /** Substrings that trigger this snippet (lowercased match against prompt). */
  triggers: RegExp | "always";
  /** Reinforcement text appended to the system prompt. */
  body: string;
}

const SNIPPETS: Record<DynamicSnippetKey, SnippetDef> = {
  // Always-on baseline. The 8-10 primitives every turn ends up using.
  kitCore: {
    triggers: "always",
    body: `\n\n[Kit — always available, import from "@/components/ui/*"]
- <Button variant="default|destructive|outline|secondary|ghost|link" size="default|sm|lg|icon">
- <Card>, <CardHeader>, <CardTitle>, <CardDescription>, <CardContent>, <CardFooter>
- <Input>, <Textarea>, <Label htmlFor>
- <Badge variant="default|secondary|destructive|outline">
- <Separator orientation="horizontal|vertical">
- <Skeleton>, <Avatar>/<AvatarImage>/<AvatarFallback>
- <Alert variant>, <AlertTitle>, <AlertDescription>
- cn() helper from "@/lib/utils" for conditional classes
- Icons: lucide-react (NEVER emoji as functional icons)
Other primitives exist (Tabs/Dialog/Sheet/Drawer/Select/Combobox/DatePicker/Calendar/Form/Chart/Table/DropdownMenu/Popover/Tooltip/Accordion/ScrollArea/Slider/Progress/Switch/Checkbox/RadioGroup/Container/Stack/Inline/Grid/Router/Toast/ThemeProvider/ThemeToggle) — they are documented further down ONLY when this turn's request matches them. If you need one that isn't documented, the import path is "@/components/ui/<kebab-name>".`,
  },
  // Fires on multi-section / landing / dashboard / page-shaped requests —
  // the exact turns that historically blew past the 180-line cap and got
  // reverted by the file-budget gate. Reinforces the split-into-files
  // pattern WITH a concrete example so the model has a template to follow.
  fileBudget: {
    triggers: /\b(landing|landing page|home ?page|dashboard|marketing site|portfolio|saas|product page|pricing page|about page|multi[- ]?page|site|website|several pages?|full app|complete app|app from scratch|build me an? app)\b/i,
    body: `\n\n[Reinforcement — Split into small files]
This turn looks like a multi-section page. The server enforces a hard 180-line / 6 KB cap per file (>280 lines is auto-reverted). To stay under it:
- Build the page as a SHELL that composes sub-components — never a single 300-line file.
- Canonical landing-page split (mirror this structure):
    src/components/Hero.tsx
    src/components/Features.tsx
    src/components/Testimonials.tsx   (if asked)
    src/components/Pricing.tsx        (if asked)
    src/components/CTA.tsx
    src/components/FooterSection.tsx
  Then src/App.tsx (or src/pages/Home.tsx) is just:
    <Container><Hero /><Features /><CTA /><FooterSection /></Container>
- Each sub-component owns its own copy/data — do not pass props down for purely-presentational content.
- The MOMENT a file you are writing crosses ~120 lines, stop and extract the next section into its own file before continuing.`,
  },
  layout: {
    triggers: /\b(layout|page|section|hero|landing|grid|stack|inline|container|sidebar|header|footer|two[- ]column|split|columns?)\b/i,
    body: `\n\n[Reinforcement — Layout primitives]
- <Container size="sm|md|lg|xl|full"> — outermost wrapper for every page section (default "lg").
- <Stack gap={4} align="start|center|end|stretch" justify="..."> — vertical columns. <Inline gap={2} align wrap> — horizontal rows. Use these instead of writing flex/gap utility chains by hand.
- <Grid preset="stats|kpis|dashboard|cards|features|pricing|split|gallery"> for instant dashboard layouts. Or compose: <Grid cols={1} sm={2} md={3} lg={4} gap={6}>. Allowed cols: 1, 2, 3, 4, 6, 12.
Read "src/components/examples/LAYOUT.md" before laying out any new page.`,
  },
  overlays: {
    triggers: /\b(modal|dialog|drawer|sheet|popover|tooltip|side panel|bottom sheet|overlay)\b/i,
    body: `\n\n[Reinforcement — Overlays]
- <Dialog>, <DialogTrigger asChild>, <DialogContent>, <DialogHeader>, <DialogTitle>, <DialogDescription>, <DialogFooter> — center modal.
- <Sheet>, <SheetTrigger asChild>, <SheetContent side="top|right|bottom|left">, <SheetHeader>, <SheetTitle>, <SheetDescription>, <SheetFooter> — desktop side panel.
- <Drawer open onOpenChange>, <DrawerTrigger asChild>, <DrawerClose asChild>, <DrawerContent>, <DrawerHeader>, <DrawerTitle>, <DrawerDescription>, <DrawerFooter> — bottom-anchored mobile sheet with handle.
- <Popover>, <PopoverTrigger asChild>, <PopoverContent align="start|center|end">.
- <Tooltip content side="top|bottom|left|right">.
NEVER hand-roll overlays with fixed positioning.`,
  },
  navigation: {
    triggers: /\b(tabs|accordion|menu|dropdown|nav|navigation|breadcrumb)\b/i,
    body: `\n\n[Reinforcement — Navigation primitives]
- <Tabs defaultValue>, <TabsList>, <TabsTrigger value>, <TabsContent value>.
- <Accordion type="single|multiple" defaultValue>, <AccordionItem value>, <AccordionTrigger>, <AccordionContent>.
- <DropdownMenu>, <DropdownMenuTrigger asChild>, <DropdownMenuContent>, <DropdownMenuItem onSelect>, <DropdownMenuLabel>, <DropdownMenuSeparator>.
- <ScrollArea> for fixed-height scrollable regions.`,
  },
  feedback: {
    triggers: /\b(progress|loading|spinner|status|busy|skeleton|placeholder)\b/i,
    body: `\n\n[Reinforcement — Feedback primitives]
- <Progress value={0..100}> — determinate bar.
- <Skeleton> — loading placeholder shape.
- <Switch checked onChange>, <Checkbox checked onChange>, <Slider min max step value onChange>, <RadioGroup value onValueChange>/<RadioGroupItem value>.`,
  },
  charts: {
    triggers: /\b(chart|graph|bar chart|line chart|area chart|analytics dashboard|kpi|metric)\b/i,
    body: `\n\n[Reinforcement — Charts]
The kit ships <LineChart>, <AreaChart>, <BarChart>, <ChartContainer> from "@/components/ui/chart". Pass data as { x, y } arrays and color={1..5}. NEVER import recharts, victory, or chart.js. NEVER hand-roll SVG bars.
Example:
  import { BarChart } from "@/components/ui/chart";
  <BarChart data={[{x:"Mon", y:12}, {x:"Tue", y:18}]} color={2} />`,
  },
  forms: {
    triggers: /\b(form|sign ?up|sign ?in|login|register|contact form|onboarding|wizard|multi-step|input field|validation)\b/i,
    body: `\n\n[Reinforcement — Forms]
Use the kit form helper, NEVER scattered useState for field values:
  import { useForm, Form, FormField } from "@/components/ui/form";
  const form = useForm({ defaults: { email: "" }, validate: v => ({ email: !v.email && "Required" }), onSubmit: async v => {...} });
  <Form {...form}><FormField name="email" label="Email"><Input /></FormField></Form>
For arrays/async validation, graduate to react-hook-form (kit does NOT include it by default — add to package.json).
Also available: <Select options={[{label,value}]} placeholder onChange>, <Combobox options={[{label,value}]} value onChange placeholder searchPlaceholder emptyText> (use for 5+ options instead of styled <select>).`,
  },
  datetime: {
    triggers: /\b(date picker|date input|calendar|appointment|booking|schedule|deadline|due date)\b/i,
    body: `\n\n[Reinforcement — Date / Calendar]
NEVER use <input type="date">. Use the kit's <DatePicker value onChange placeholder> from "@/components/ui/date-picker". For raw inline month grids use <Calendar mode="single|range" selected onSelect>.`,
  },
  tables: {
    triggers: /\b(table|data grid|list view|users? list|invoices?|orders?|spreadsheet|rows? of)\b/i,
    body: `\n\n[Reinforcement — Tables]
Use <Table>/<TableHeader>/<TableBody>/<TableRow>/<TableHead>/<TableCell>/<TableFooter>/<TableCaption> from "@/components/ui/table". For interactive features (sorting, filtering, pagination) wrap with hand-rolled state — the kit does NOT bundle tanstack-table. Reference: "src/components/examples/table-paginated.tsx".`,
  },
  router: {
    triggers: /\b(multi-?page|pages?|route|navigation|nav bar|menu link|landing.*about|home.*pricing|several screens)\b/i,
    body: `\n\n[Reinforcement — Routing]
Multi-page apps MUST use "@/components/ui/router" (re-exports react-router-dom, including Router/Routes/Route and RouterProvider/createBrowserRouter/RouteObject). Prefer <Router><Routes><Route element={<Layout />}><Route path="/" element={<Home />} />…</Route></Routes></Router> in src/App.tsx, put pages in src/pages/<Name>.tsx. NEVER import from "react-router-dom" directly. NEVER use useState for "current page". NEVER use <a href="/x"> for in-app links — use <Link to="/x">.
PAGE EXPORTS: prefer plain named exports + eager imports. React.lazy(() => import("@/pages/X")) only works if X also has \`export default\` — otherwise crashes at render with React error #306.`,
  },
  auth: {
    triggers: /\b(auth|login|sign ?up|sign ?in|password|otp|magic link|user account|protected route)\b/i,
    body: `\n\n[Reinforcement — Auth (only if backend is connected)]
Use ONLY the helpers exported from "@/integrations/backend/auth": useAuth(), signUpWithPassword, signInWithPassword, signInWithOtp, verifyOtp, verifySignupOtp, resendSignupOtp, resetPasswordForEmail, updatePassword, signOut. After signUpWithPassword, verify with verifySignupOtp (NOT verifyOtp). NEVER call supabase.auth.* directly. NEVER import from "@supabase/supabase-js". Read "src/components/examples/BACKEND.md" for full reference.`,
  },
  // Fires when the user asked for auth / data / accounts / uploads / realtime
  // BUT no backend is connected to this project. Triggers are matched in
  // pickDynamicSnippets only when args.hasBackend === false. This is a
  // POSITIVE instruction — we tell the model exactly what to do instead of
  // hoping it remembers the buried PREREQUISITE GATING rule. Without this
  // block the model has historically (a) bailed to prose and (b) emitted
  // imports from "@/integrations/backend/*" that don't resolve.
  noBackendGate: {
    triggers: "always", // gating handled in pickDynamicSnippets
    body: `\n\n[CRITICAL — No backend is connected to this project]
The user asked for a feature that normally needs a backend (auth, accounts, login, persistent data, comments, uploads, realtime, etc.) — but THIS project has no backend yet.

You MUST still call write_project (or patch_files). Never reply with prose. Never bail.

What to build:
- Scaffold the UI ONLY: forms, empty states, mock lists, disabled "Sign in" buttons, etc. Use realistic placeholder data inline (NOT from a database).
- DO NOT import from "@/integrations/backend/*" — those files do not exist in this project and the build will fail.
- DO NOT import "@supabase/supabase-js", do NOT call createClient, do NOT hardcode any keys or URLs.
- DO NOT add any auth/data wiring. Leave a clear \`// TODO: connect backend\` comment where the wiring would go.

What to say:
- In "plan" and "summary", in plain friendly English, tell the user that you've built the UI and that to make it real (save data / let users sign in / etc.) they should tap the "Add backend" chip below the chat. Keep it warm, not technical.
- Do NOT mention Supabase, edge functions, or any infra names — just "a backend".`,
  },
  images: {
    triggers: /\b(image|photo|picture|hero|illustration|avatar|background|banner|cover|logo|gallery)\b/i,
    body: `\n\n[Reinforcement — Images]
Use \`petal-image://<descriptive-prompt>\` for any AI-generated visual. Be SPECIFIC (e.g. "petal-image://cozy-coffee-shop-hero-warm-morning-light"). Max 6 unique placeholders per turn — extras silently fall back to picsum. NEVER use unsplash.com / placeholder.com / picsum.photos when petal-image:// fits. Fake testimonial avatars MAY use https://i.pravatar.cc/150?u=<seed>.`,
  },
  tailwindv4: {
    triggers: /\b(theme|color|palette|brand color|dark mode|styles?\.css|@theme|tailwind)\b/i,
    body: `\n\n[Reinforcement — Tailwind v4 + styles.css]
Tailwind v4 syntax ONLY: \`@import "tailwindcss";\` on line 1, \`@theme { --color-primary: oklch(...); --radius-lg: 0.75rem; }\`. NEVER use v3 \`@tailwind base/components/utilities\` directives — they are removed in v4 and abort the build. NEVER \`@apply\` an undefined class. When unsure, EMIT NOTHING for src/styles.css and let the scaffold's defaults win.`,
  },
  toast: {
    triggers: /\b(toast|notification|alert message|success message|error message|snackbar|flash message)\b/i,
    body: `\n\n[Reinforcement — Toasts]
Mount <Toaster /> ONCE in App.tsx (or main.tsx). Then call toast.success("Saved.") / toast.error("…") / toast("Default") from "@/components/ui/toast" anywhere. NEVER build a custom alert div for ephemeral feedback.`,
  },
};

/** Extract plain-text content from a chat message (strips attachments shape). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: string }).text) : ""))
      .join(" ");
  }
  return "";
}

/**
 * Pick reinforcement snippets that match the latest user turn.
 *
 * Always includes the "kitCore" baseline. Bias toward the LAST user
 * message (most recent intent) but also peek at the previous one for
 * context. Cap at 6 topical snippets to keep prompt size reasonable
 * while still covering compound asks (e.g. "auth + dashboard with charts").
 */
export function pickDynamicSnippets(args: {
  /** Full message thread (oldest → newest). */
  messages: Array<{ role: string; content: unknown }>;
  /** When true, skip the auth block (no backend connected). */
  hasBackend: boolean;
}): { snippets: DynamicSnippetKey[]; text: string } {
  const userTurns = args.messages
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => messageText(m.content))
    .join(" ");
  const haystack = userTurns.toLowerCase();

  const matched: DynamicSnippetKey[] = [];
  // kitCore is always first — the baseline primitives every turn needs.
  matched.push("kitCore");

  // No-backend gate: if the user mentioned a capability that needs a
  // backend but none is connected, inject explicit "scaffold UI-only and
  // tell the user to enable a backend" instructions. Without this the
  // model either bails to prose or imports modules that don't exist.
  const NEEDS_BACKEND_RX =
    /\b(auth|login|log ?in|sign ?up|sign ?in|password|otp|magic link|account|protected route|profile|database|persist|save (data|users?|posts?|comments?|orders?)|crud|comments?|posts?|orders?|todo|notes?|messages?|chat|upload|file upload|avatar upload|attachment|storage|realtime|live (chat|update)|presence)\b/i;
  if (!args.hasBackend && NEEDS_BACKEND_RX.test(haystack)) {
    matched.push("noBackendGate");
  }

  for (const key of Object.keys(SNIPPETS) as DynamicSnippetKey[]) {
    if (key === "kitCore") continue;
    if (key === "noBackendGate") continue; // handled above
    if (key === "auth" && !args.hasBackend) continue;
    const def = SNIPPETS[key];
    if (def.triggers !== "always" && def.triggers.test(haystack)) {
      matched.push(key);
    }
  }

  // Cap at 8 total (kitCore + noBackendGate + 6 topical).
  const picked = matched.slice(0, 8);
  const text = picked.map((k) => SNIPPETS[k].body).join("");
  return { snippets: picked, text };
}

/**
 * Inject the actual current date into the system prompt.
 *
 * Why: LLM training data has a knowledge cutoff (typically 2024). Without
 * this, models default to writing `© 2024` in footers, "last updated 2024"
 * in copy, and similar stale year references. We give them ground truth so
 * every generated app reflects the real current year.
 */
export function renderCurrentDateBlock(now: Date = new Date()): string {
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const year = now.getUTCFullYear();
  const human = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `\n\n[Current date — use this, not your training cutoff]
Today is ${human} (${iso}). The current year is ${year}.
When writing footers, copyright notices ("© ${year}"), "last updated" labels, blog post dates, or any other user-facing date, use ${year} (or a sensible recent year). Never default to 2023 or 2024.`;
}

