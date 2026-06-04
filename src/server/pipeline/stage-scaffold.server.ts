/**
 * Staged Pipeline — Stage 2: SCAFFOLD (parallel)
 *
 * Generates one file per AI call, in parallel, each call constrained to a
 * single file with a tight token budget. This eliminates the two failure
 * modes a monolithic write_project hits:
 *   - Output truncation (no single call ever fills the ceiling).
 *   - "All-or-nothing" failure (one file failing only re-runs that file).
 *
 * Per-file budget math:
 *   - Plan caps at 10 files; each gets ~2500 tokens (root view 3200) →
 *     parallel output peak well below ceilings.
 *   - Each generated file is parser-validated before we accept it. On
 *     parse failure we re-emit the WHOLE file with the previous attempt +
 *     parser error in the user prompt (FULL token budget — never shrink,
 *     shrinking is what caused the truncation cliff for medium files).
 *   - Token-cap truncation also triggers a full re-emit retry.
 *   - If both attempts fail with `syntax_error`, the scaffold returns
 *     ok:false reason:"scaffold_syntax_unrecoverable" so the orchestrator
 *     can silently fall back to the monolithic path (same pattern as
 *     missing_root_view).
 *
 * Quality inputs (Phase 1 + 3 of the staged-pipeline rebuild):
 *   - context.designSummary — short rendered summary of the committed
 *     design direction (vibe + palette + typography). Threaded into every
 *     file's system prompt so each component is built to the same look.
 *
 * Failure surface kept honest:
 *   - Promise.allSettled — never let a rejected promise crash the stage.
 *   - tool_choice is forced; the model cannot reply in prose.
 *   - JSON parse errors and missing-content cases are caught per file.
 */

import { parse as babelParse } from "@babel/parser";
import { aiChatCompletions } from "@/server/ai-provider.server";
import type { ProjectFile } from "@/server/generate.server";
import type { PlannedFile } from "./stage-plan.server";

export interface FileOutcome {
  path: string;
  ok: boolean;
  reason?: string;
}

export interface StageScaffoldResult {
  ok: true;
  files: ProjectFile[];
  outcomes: FileOutcome[];
  /** Files that failed parse on BOTH attempts. Non-empty = wire-up should fall back. */
  syntaxUnrecoverable: string[];
}

export interface StageScaffoldFailure {
  ok: false;
  reason: string;
  outcomes: FileOutcome[];
}

const WRITE_FILE_TOOL = {
  type: "function" as const,
  function: {
    name: "write_file",
    description:
      "Emit the COMPLETE source for a single file. Do not include any other files. Do not include prose.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path of the file being written." },
        content: { type: "string", description: "The complete file contents." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
};

/**
 * Quick syntactic validation via @babel/parser. We only care whether the
 * file PARSES — type checking is downstream. Returns `null` on success,
 * a short error message on failure. Skipped for non-TS/JS extensions
 * (the planner never plans those, but be defensive).
 */
function validateFileSyntax(path: string, content: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return null;
  try {
    babelParse(content, {
      sourceType: "module",
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: ["typescript", "jsx", "decorators-legacy", "topLevelAwait"],
    });
    return null;
  } catch (e) {
    if (e && typeof e === "object" && "message" in e) {
      const msg = String((e as { message?: unknown }).message ?? "parse failed");
      // Babel error messages look like "Unexpected token (12:5)". Keep
      // the original — the position helps the retry prompt.
      return msg.slice(0, 240);
    }
    return "parse failed";
  }
}

/**
 * Heuristic: does this parse error smell like the file got chopped mid-output
 * (token cap hit) rather than a real syntax mistake? Babel reports truncation
 * as "Unterminated string constant", "Unterminated template", or "Unexpected
 * token" at the very end of the buffer. We treat these as "truncated" so the
 * retry path raises the budget instead of echoing the broken text back at the
 * model (which triggers a known Gemini degenerate loop where it repeats the
 * last token — "Fixed. Fixed. Fixed." — until the cap).
 */
function looksLikeTruncation(content: string, parseError: string): boolean {
  if (/Unterminated (string|template|comment|regular expression)/i.test(parseError)) return true;
  // Brace deficit: more opens than closes means the file ended mid-block.
  const opens = (content.match(/\{/g) ?? []).length;
  const closes = (content.match(/\}/g) ?? []).length;
  if (opens - closes >= 1) return true;
  // Doesn't end on a line that looks complete.
  const tail = content.trimEnd().slice(-1);
  if (!["}", ";", ")", "]", ">", "`"].includes(tail)) return true;
  return false;
}

interface ScaffoldOneArgs {
  file: PlannedFile;
  brief: string;
  manifestSummary: string;
  designSummary?: string;
  /**
   * Previous failed attempt — passed into a retry so the model can see
   * its mistake. When set, we use the FULL token budget (no shrink) and
   * include the parser error in the user prompt.
   */
  previousAttempt?: { content: string; parserError: string };
  /**
   * True when the prior attempt ran out of tokens. Raises the budget and
   * tells the model to ship a tighter version — does NOT echo the broken
   * text back (that's what causes the "Fixed. Fixed. Fixed." loop).
   */
  truncationRetry?: boolean;
}

async function scaffoldOne(
  args: ScaffoldOneArgs,
): Promise<{ ok: true; file: ProjectFile } | { ok: false; reason: string; lastContent?: string }> {
  const { file, brief, manifestSummary, designSummary, previousAttempt, truncationRetry } = args;
  const isRoot = file.path === "src/App.tsx";
  const isMarketing = file.path.startsWith("src/components/marketing/");
  const isApp = file.path.startsWith("src/components/app/");
  const isAuthCard = file.path.endsWith("/AuthCard.tsx");
  const isAppShell = file.path.endsWith("/AppShell.tsx");
  // Marketing + app-surface components need more room — a real hero, pricing
  // section, or AppShell with sidebar+topbar is 200-280 lines once chrome is real.
  const lineCap = isMarketing
    ? Math.min(300, file.est_lines + 80)
    : isApp
      ? Math.min(320, file.est_lines + 80)
      : Math.min(240, file.est_lines + 60);
  // Base caps lifted (marketing 3600→4800, app 3800→5000) — the contracts
  // above (hero + dual CTA + product mock + 4-col footer + pricing tiers +
  // FAQ accordion) regularly cleared 3600 and got chopped.
  const baseTokenCap = isRoot ? 3600 : isMarketing ? 4800 : isApp ? 5000 : 3200;
  // Truncation retry: 1.5× headroom so the tighter rewrite has room to land.
  const tokenCap = truncationRetry ? Math.round(baseTokenCap * 1.5) : baseTokenCap;


  const rootRules = isRoot
    ? `\nTHIS IS THE ROOT VIEW (src/App.tsx). Extra rules:\n` +
      `- Must contain REAL domain UI matching the brief — header, primary content area showing the actual feature, and any nav.\n` +
      `- NEVER return a "coming soon", "placeholder", "is being prepared", or "ask Petal to retry" card. That is a bug, not a valid output.\n` +
      `- Import and use the components listed in deps so the screen actually renders content.\n` +
      `- Default export must be \`function App\` returning visible JSX.`
    : "";

  const marketingRules = isMarketing
    ? `\nTHIS IS A MARKETING COMPONENT (${file.path}). You are building a Stripe/Linear/Notion-grade landing page section. Extra rules:\n` +
      `- FORBIDDEN: a centered single-column hero with only headline + Login/Sign-Up buttons + plain bordered cards. That is a placeholder, not a landing page.\n` +
      `- FORBIDDEN copy: "Welcome to Our X", "Streamline your X with our powerful and intuitive X solution", any lorem-ish filler. Write specific, opinionated copy tied to the brief's actual domain.\n` +
      `- Section wrapper rhythm: \`py-20 sm:py-28\` with \`container mx-auto px-6\` (Navbar/Footer use their own padding).\n` +
      `- Headings: \`text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight\`. Subheads: \`text-lg text-muted-foreground\` max-w-2xl.\n` +
      `- Cards: \`rounded-2xl border bg-card/50 backdrop-blur p-6\` with hover state \`hover:border-primary/40 transition\`. Always include an icon (lucide-react) in a \`rounded-lg bg-primary/10 text-primary size-10 p-2\` wrapper.\n` +
      `- Grids: ALWAYS declare the mobile base before responsive prefixes — e.g. \`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3\`. Never bare \`grid-cols-2\`.\n` +
      `- Hero specifically: must include an eyebrow pill/badge, ONE phrase in the headline wrapped with a gradient span (\`bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent\`), a dual CTA row, a trust row with muted logo wordmarks, AND a mocked product visual panel (rounded-2xl border bg-card/50 shadow-2xl with fake dashboard chrome). No external images.\n` +
      `- Navbar: sticky top-0 z-50 with \`bg-background/70 backdrop-blur-md border-b\`, height h-16.\n` +
      `- Footer: 4-column link grid + bottom row with copyright. Not a single centered line.\n` +
      `- Use lucide-react for ALL icons. Use shadcn primitives (Button, Badge, Accordion, Avatar) — never raw <button>.`
    : "";

  const appRules = isApp
    ? `\nTHIS IS AN AUTHENTICATED APP-SURFACE COMPONENT (${file.path}). You are building a Linear/Notion/Stripe-grade product surface. Extra rules:\n` +
      `- FORBIDDEN: three placeholder cards in a centered grid, "Coming soon" panels, lorem-ish row data ("Item 1", "Item 2"), a single empty Card with a "Save" button as an entire settings page, or a dashboard that is just 3 stat tiles and nothing else.\n` +
      `- FORBIDDEN copy: "Welcome to your dashboard", "Manage your X here", any generic chrome text. Use real domain language tied to the brief.\n` +
      `- Seed data MUST be realistic: 8-20 rows for tables, real-sounding names (Sarah Chen, Marcus Webb), companies (Acme, Linear, Vercel), amounts ($12,450), dates (Mar 14), statuses (Qualified, In review, Closed). Define seed data as a local const array at the top of the file — do NOT generate it inline.\n` +
      `- Layout rhythm: page-level surfaces use \`p-6 md:p-8 space-y-6\`; section cards use \`rounded-xl border bg-card p-6\`; headings use \`text-2xl font-bold tracking-tight\` (page) or \`text-lg font-semibold\` (section).\n` +
      `- Mobile-first: tables collapse to stacked cards under \`sm:\`, sidebar collapses to a shadcn \`Sheet\` triggered by a Menu icon button (\`md:hidden\`), all multi-column grids declare \`grid-cols-1\` base before \`sm:/md:/lg:\`.\n` +
      `- Use lucide-react for ALL icons. Use shadcn primitives (Button, Input, Select, Badge, Avatar, Table, Tabs, DropdownMenu, Switch, Sheet) — never raw <button>, <input>, hand-rolled cards.\n` +
      `\nCOMPONENT CONTRACT CHECKLIST (every primitive you ship MUST satisfy its row — this is not optional):\n` +
      `  1. Button — uses shadcn \`Button\`, not raw \`<button>\`. Async actions show a loading state (spinner + disabled). Destructive actions use \`variant="destructive"\`. Icon-only buttons MUST have \`aria-label\`.\n` +
      `  2. Form — every input is wrapped in shadcn \`Form\` + \`FormField\` + \`FormItem\` + \`FormLabel\` + \`FormControl\` + \`FormMessage\`. Validation errors render via \`<FormMessage />\`. Submit button shows pending state. NEVER raw \`<form>\` with bare \`<input>\`.\n` +
      `  3. Table — shadcn \`Table\` with TableHeader/TableRow/TableHead/TableCell, sticky header (sticky top-0 bg-background), row hover \`hover:bg-muted/50\`, status cells use \`Badge\` with semantic variants, action cells use \`DropdownMenu\` + MoreHorizontal icon. Avatar + name + sub-line pattern for primary-identity cells. MUST handle the empty case: if \`rows.length === 0\` render a centered TableEmpty block (icon in \`rounded-full bg-muted size-12\`, headline, muted line, CTA Button) INSTEAD of an empty \`<tbody>\`.\n` +
      `  4. Card — interactive cards have \`hover:border-primary/40 transition\`. Lists of cards that fetch data render \`Skeleton\` placeholders during loading, never a blank panel.\n` +
      `  5. Empty state — every list/table/grid surface defines a populated state AND a fallback empty state (icon + headline + muted line + CTA). Render the populated state by default; empty is the fallback.\n` +
      `  6. Loading state — async surfaces render shadcn \`Skeleton\` rows/cards matching the eventual layout, never a bare "Loading…" string.\n` +
      `  7. Error state — surfaces that can fail render an inline error block (AlertTriangle icon, message, Retry Button), never an unhandled throw.\n` +
      (isAppShell
        ? `\n- AppShell-specific: MUST render a left sidebar (\`w-64 shrink-0 border-r bg-card/30 hidden md:flex flex-col\`) with logo + workspace switcher + nav list + user card, AND a top bar (\`h-14 border-b flex items-center justify-between px-6\`) with mobile Sheet trigger + breadcrumb + search + Bell + Avatar, AND a \`<main class="flex-1 overflow-y-auto">\` content area. Maintain an \`activeRoute\` state and render the matching child component inside main. Active nav item gets \`bg-accent text-accent-foreground\`.`
        : "") +
      (isAuthCard
        ? `\n- AuthCard-specific: MUST be a 2-pane layout (\`min-h-screen grid lg:grid-cols-2\`) with a branded left pane (\`hidden lg:flex bg-gradient-to-br from-primary/10 via-background to-background\` with headline + testimonial card) and a right pane with Tabs (signin/signup) containing Email + Password Inputs, primary Button w-full, a divider, Google + GitHub outline buttons, and a 'Continue as demo' link. NOT a single centered card on white.`
        : "")
    : "";

  const designLine = designSummary
    ? `\nDesign direction (committed for this build): ${designSummary}. Use these tokens and typography choices, not generic shadcn defaults.`
    : "";

  const systemContent =
    `You write ONE file at a time for a Vite + React + TypeScript app using Tailwind v4 and the bundled shadcn UI kit at "@/components/ui/*". ` +
    `Always call write_file — never reply in prose. ` +
    `Hard cap: ${lineCap} lines for this file. Stay well under it. ` +
    `Your output MUST be syntactically valid TS/TSX — balanced parens/braces, every JSX tag closed, every import on its own line, no half-written expressions. ` +
    `Use semantic tokens (bg-background, text-foreground, bg-primary, etc.) — never raw colors. ` +
    `Use kit primitives (Button, Card, Input, etc.) — never raw <button>, <input>, hand-rolled cards. ` +
    `Import only files that exist either in the manifest below or in the standard scaffold (src/components/ui/*, src/lib/utils, src/integrations/backend/*).` +
    designLine +
    rootRules +
    marketingRules +
    appRules;

  const retryBlock = previousAttempt
    ? `\n\nPREVIOUS ATTEMPT FAILED to parse with: ${previousAttempt.parserError}\nDo not repeat the same mistake. Re-emit the COMPLETE file (not a diff) with the syntax fixed. Your previous attempt began:\n\n${previousAttempt.content.slice(0, 600)}…`
    : "";

  try {
    const upstream = await aiChatCompletions({
      feature: "generate",
      body: {
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemContent },
          {
            role: "user",
            content:
              `App brief: ${brief}\n\n` +
              `Project plan: ${manifestSummary}\n\n` +
              `Write THIS file only:\n` +
              `  path: ${file.path}\n` +
              `  purpose: ${file.purpose}\n` +
              `  depends on: ${file.deps.join(", ") || "(none)"}\n` +
              `  est lines: ${file.est_lines}\n` +
              retryBlock,
          },
        ],
        tools: [WRITE_FILE_TOOL],
        tool_choice: { type: "function", function: { name: "write_file" } },
        max_tokens: tokenCap,
        stream: false,
      },
      timeoutTier: "default",
      meta: { phase: "implement", promptChars: brief.length },
    });

    if (!upstream.ok) return { ok: false, reason: `upstream_${upstream.status}` };

    const json = (await upstream.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const choice = json.choices?.[0];
    if (choice?.finish_reason === "length") {
      return { ok: false, reason: "truncated" };
    }
    const argsStr = choice?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { ok: false, reason: "no_tool_call" };

    const parsed = JSON.parse(argsStr) as { path?: string; content?: string };
    if (!parsed.content || parsed.content.length < 10) {
      return { ok: false, reason: "empty_content" };
    }

    // Parser gate. We only accept files that parse cleanly — otherwise
    // they'll blow up in the bundler or at render and the user will see
    // the autofix-narrating-its-fix chat leak we just removed.
    const parseError = validateFileSyntax(file.path, parsed.content);
    if (parseError) {
      return { ok: false, reason: `syntax_error:${parseError}`, lastContent: parsed.content };
    }

    // Honor the planned path even if the model echoed a different one.
    return { ok: true, file: { path: file.path, content: parsed.content } };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "scaffold_threw" };
  }
}

interface ScaffoldContext {
  /** Compact one-line rendering of the design direction. */
  designSummary?: string;
}

export async function runStageScaffold(args: {
  plan: PlannedFile[];
  brief: string;
  manifestSummary: string;
  context?: ScaffoldContext;
}): Promise<StageScaffoldResult | StageScaffoldFailure> {
  const designSummary = args.context?.designSummary;
  // Fire all files in parallel. allSettled means one rejected promise
  // never aborts the others — we collect every outcome.
  const firstPass = await Promise.allSettled(
    args.plan.map((file) =>
      scaffoldOne({ file, brief: args.brief, manifestSummary: args.manifestSummary, designSummary }),
    ),
  );

  const files: ProjectFile[] = [];
  const outcomes: FileOutcome[] = [];
  interface RetryItem {
    file: PlannedFile;
    previousAttempt?: { content: string; parserError: string };
  }
  const retryQueue: RetryItem[] = [];

  firstPass.forEach((res, i) => {
    const planned = args.plan[i];
    if (res.status === "fulfilled" && res.value.ok) {
      files.push(res.value.file);
      outcomes.push({ path: planned.path, ok: true });
      return;
    }
    const reason =
      res.status === "fulfilled"
        ? (res.value as { ok: false; reason: string }).reason
        : (res.reason as Error)?.message ?? "rejected";
    const lastContent =
      res.status === "fulfilled"
        ? (res.value as { ok: false; reason: string; lastContent?: string }).lastContent
        : undefined;
    // Build retry context: only feed previous attempt back when it was a
    // syntax error — for upstream/truncation failures the previous content
    // is useless or absent.
    const isSyntax = reason.startsWith("syntax_error:");
    retryQueue.push({
      file: planned,
      previousAttempt:
        isSyntax && lastContent
          ? { content: lastContent, parserError: reason.slice("syntax_error:".length) }
          : undefined,
    });
    outcomes.push({ path: planned.path, ok: false, reason: `first:${reason}` });
  });

  const syntaxUnrecoverable: string[] = [];

  if (retryQueue.length) {
    const retried = await Promise.allSettled(
      retryQueue.map((item) =>
        scaffoldOne({
          file: item.file,
          brief: args.brief,
          manifestSummary: args.manifestSummary,
          designSummary,
          previousAttempt: item.previousAttempt,
        }),
      ),
    );
    retried.forEach((res, i) => {
      const planned = retryQueue[i].file;
      const outcomeIdx = outcomes.findIndex((o) => o.path === planned.path);
      if (res.status === "fulfilled" && res.value.ok) {
        files.push(res.value.file);
        if (outcomeIdx >= 0) outcomes[outcomeIdx] = { path: planned.path, ok: true, reason: "retried" };
        return;
      }
      const reason =
        res.status === "fulfilled"
          ? (res.value as { ok: false; reason: string }).reason
          : (res.reason as Error)?.message ?? "rejected";
      if (outcomeIdx >= 0) {
        outcomes[outcomeIdx] = {
          path: planned.path,
          ok: false,
          reason: `${outcomes[outcomeIdx].reason} | retry:${reason}`,
        };
      }
      // Track syntax-unrecoverable separately so the orchestrator can
      // decide to fall back to the monolithic path.
      const firstWasSyntax = (outcomes[outcomeIdx]?.reason ?? "").includes("first:syntax_error");
      const retryWasSyntax = reason.startsWith("syntax_error:");
      if (firstWasSyntax && retryWasSyntax) {
        syntaxUnrecoverable.push(planned.path);
      }
    });
  }

  // Stage succeeds if AT LEAST one file came back. Wire-up decides
  // whether the partial set is usable; a totally empty result fails.
  if (files.length === 0) {
    return { ok: false, reason: "all_files_failed", outcomes };
  }

  return { ok: true, files, outcomes, syntaxUnrecoverable };
}
