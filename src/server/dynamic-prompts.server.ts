/**
 * Dynamic system-prompt snippets (Tier 2 reliability).
 *
 * The base SYSTEM_PROMPT_INITIAL / SYSTEM_PROMPT_PATCH already covers the
 * full kit. v0/Cursor get extra mileage by adding *reinforcement* blocks for
 * the specific patterns the user is asking about — this both raises success
 * rate (model focuses) and lets us pin version-specific snippets without
 * bloating every prompt.
 *
 * Strategy: keyword-match the latest user turn (+ recent history), and
 * append concise reinforcement blocks for matched topics. Only add ~50-300
 * tokens per match, capped at 3 blocks to stay token-conscious.
 */

export type DynamicSnippetKey =
  | "charts"
  | "forms"
  | "datetime"
  | "tables"
  | "router"
  | "auth"
  | "images"
  | "tailwindv4"
  | "toast";

interface SnippetDef {
  /** Substrings that trigger this snippet (lowercased match against prompt). */
  triggers: RegExp;
  /** Reinforcement text appended to the system prompt. */
  body: string;
}

const SNIPPETS: Record<DynamicSnippetKey, SnippetDef> = {
  charts: {
    triggers: /\b(chart|graph|bar chart|line chart|area chart|analytics dashboard|kpi|metric)\b/i,
    body: `\n\n[Reinforcement — Charts]
The kit ships <LineChart>, <AreaChart>, <BarChart> from "@/components/ui/chart". Pass data as { x, y } arrays and color={1..5}. NEVER import recharts, victory, or chart.js. NEVER hand-roll SVG bars.
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
For arrays/async validation, graduate to react-hook-form (kit does NOT include it by default — add to package.json).`,
  },
  datetime: {
    triggers: /\b(date picker|date input|calendar|appointment|booking|schedule|deadline|due date)\b/i,
    body: `\n\n[Reinforcement — Date / Calendar]
NEVER use <input type="date">. Use the kit's <DatePicker value onChange placeholder> from "@/components/ui/date-picker". For raw inline month grids use <Calendar mode="single|range" selected onSelect>.`,
  },
  tables: {
    triggers: /\b(table|data grid|list view|users? list|invoices?|orders?|spreadsheet|rows? of)\b/i,
    body: `\n\n[Reinforcement — Tables]
Use <Table>/<TableHeader>/<TableBody>/<TableRow>/<TableHead>/<TableCell> from "@/components/ui/table". For interactive features (sorting, filtering, pagination) wrap with hand-rolled state — the kit does NOT bundle tanstack-table. Reference: "src/components/examples/table-paginated.tsx".`,
  },
  router: {
    triggers: /\b(multi-?page|pages?|route|navigation|nav bar|menu link|landing.*about|home.*pricing|several screens)\b/i,
    body: `\n\n[Reinforcement — Routing]
Multi-page apps MUST use "@/components/ui/router" (re-exports react-router-dom, including Router/Routes/Route and RouterProvider/createBrowserRouter/RouteObject). Prefer <Router><Routes><Route element={<Layout />}><Route path="/" element={<Home />} />…</Route></Routes></Router> in src/App.tsx, put pages in src/pages/<Name>.tsx. NEVER import from "react-router-dom" directly. NEVER use useState for "current page". NEVER use <a href="/x"> for in-app links — use <Link to="/x">.`,
  },
  auth: {
    triggers: /\b(auth|login|sign ?up|sign ?in|password|otp|magic link|user account|protected route)\b/i,
    body: `\n\n[Reinforcement — Auth (only if backend is connected)]
Use ONLY the helpers exported from "@/integrations/backend/auth": useAuth(), signUpWithPassword, signInWithPassword, signInWithOtp, verifyOtp, verifySignupOtp, resendSignupOtp, resetPasswordForEmail, updatePassword, signOut. After signUpWithPassword, verify with verifySignupOtp (NOT verifyOtp). NEVER call supabase.auth.* directly. NEVER import from "@supabase/supabase-js". Read "src/components/examples/BACKEND.md" for full reference.`,
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
Mount <Toaster /> ONCE in App.tsx. Then call toast.success("Saved.") / toast.error("…") / toast("Default") from "@/components/ui/toast" anywhere. NEVER build a custom alert div for ephemeral feedback.`,
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
 * We bias toward the LAST user message (most recent intent) but also peek at
 * the previous one for context. Capped at 3 snippets to keep prompt size sane.
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
  for (const key of Object.keys(SNIPPETS) as DynamicSnippetKey[]) {
    if (key === "auth" && !args.hasBackend) continue;
    if (SNIPPETS[key].triggers.test(haystack)) matched.push(key);
  }

  // Cap at 3 (most-specific wins; iteration order above is stable).
  const picked = matched.slice(0, 3);
  const text = picked.map((k) => SNIPPETS[k].body).join("");
  return { snippets: picked, text };
}
