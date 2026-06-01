/**
 * Staged Pipeline — Stage 1: PLAN
 *
 * Asks a model to emit a file MANIFEST for an MVP, NOT code. The manifest
 * is later consumed by Stage 2 (scaffold) which generates each file in
 * parallel, isolated calls.
 *
 * CONTRACT:
 *   - Target stack is Vite + React + TS + Tailwind v4 (NOT TanStack Start).
 *     The user-app kit mounts via src/main.tsx → <App /> in src/App.tsx.
 *   - src/App.tsx is ALWAYS the root view and is ALWAYS file #1 in the
 *     plan. If the model omits it, we inject it deterministically below.
 *   - index.html and src/main.tsx are Petal-owned and must NEVER appear
 *     in the plan — the renderable-shell guard writes them.
 *   - src/styles.css is Petal-owned and must NEVER appear in the plan —
 *     the orchestrator pre-writes it from the chosen theme tokens.
 *   - src/routes/* is NEVER planned — this is not TanStack.
 *
 * Quality inputs (Phase 1 + 3 of the staged-pipeline rebuild):
 *   - appShapeBlock — rendered output of classifyAppShape(brief). Tells
 *     the planner the category + surfaces so it picks the right layout
 *     archetype (feed, marketing, dashboard, tool, game) instead of
 *     defaulting to "sidebar + dashboard" for everything.
 *   - designDirectionBlock — rendered output of pickDesignDirection().
 *     Tells the planner the vibe + typography + density so component
 *     names and counts match the aesthetic.
 *
 * Why this matters: before the fix the plan stage had a thin prompt and
 * received no shape/design context. Even when the monolithic path had
 * already computed both, the staged path threw them away. Result:
 * "sidebar + dashboard" plans for prompts that obviously wanted a feed.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";

export interface PlannedFile {
  /** App-relative path, e.g. "src/App.tsx". */
  path: string;
  /** One-sentence purpose for the scaffold pass to read. */
  purpose: string;
  /** Other planned paths this file imports/depends on. */
  deps: string[];
  /** Estimated lines — used by Stage 2 to size each call. */
  est_lines: number;
}

export interface StagePlanResult {
  ok: true;
  files: PlannedFile[];
  summary: string;
}

export interface StagePlanFailure {
  ok: false;
  reason: string;
}

function buildPlanTool(maxFiles: number) {
  return {
    type: "function" as const,
    function: {
      name: "emit_plan",
      description: `Emit a file manifest for an MVP. Cap at ${maxFiles} files. Each file gets a path, a one-sentence purpose, its dependency list, and an estimated line count.`,
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "One sentence describing the app being planned.",
          },
          files: {
            type: "array",
            minItems: 1,
            maxItems: maxFiles,
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                purpose: { type: "string" },
                deps: { type: "array", items: { type: "string" } },
                est_lines: { type: "number" },
              },
              required: ["path", "purpose", "deps", "est_lines"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "files"],
        additionalProperties: false,
      },
    },
  };
}

const SYSTEM_PROMPT = `You plan MVPs for a Vite + React + TypeScript app using Tailwind v4 and the bundled shadcn UI kit at "@/components/ui/*".
Always call emit_plan — never reply in prose.

HARD RULES:
1. src/App.tsx is ALWAYS the root view and MUST be file #1 in the plan. It renders the full MVP shell (header + primary content showing the actual feature + nav/footer where appropriate). Never a placeholder.
2. Other files are components imported by src/App.tsx (e.g. src/components/PostCard.tsx, src/components/Composer.tsx). Aim for 3–7 components total for a single-surface app, 8–14 for a business-app (marketing + product).
3. NEVER plan index.html, src/main.tsx, or src/styles.css — Petal writes those itself.
4. NEVER plan src/routes/* — this is NOT TanStack Start. Routing, if needed, lives inside src/App.tsx with simple state or react-router.
5. Skip backend wiring unless explicitly required by the brief.

LAYOUT ARCHETYPE (choose ONE, drive the file plan from it):
- feed → single-column. Composer at top + post cards stream below. Optional tag/sort chip rail. NO sidebar, NO "DashboardPage" component, NO admin panel.
- marketing → hero + 3–5 stacked sections (features, social proof, CTA) + footer. NO auth shells.
- dashboard → sidebar + main content area. ONLY use this when the user explicitly asked for a dashboard, admin tool, analytics surface, or internal tool.
- tool → centered canvas/workspace (calculator, editor, generator). Minimal chrome.
- game → full-bleed play surface + score HUD. No marketing chrome.
- content → reader layout (article list + detail), generous whitespace.
- business-app → BOTH a public marketing site AND an authenticated app shell, shipped together. Think Stripe/Linear/Notion: a customer-facing landing site that sells the product, plus a real logged-in product behind sign-up. Plan ~6 marketing components (Hero, Features, Pricing, Testimonials, FAQ, Footer) AND ~4–6 app components (AuthCard, AppShell with sidebar, Dashboard with domain-specific widgets, SettingsPanel, plus 1–2 surfaces matching the domain — e.g. CRM → ContactsTable + Pipeline; fintech → Wallet + Transactions; AI startup → Workspace + UsageMeter). src/App.tsx does lightweight routing between marketing and app sections (hash router, simple state, or react-router) and gates app routes behind a mock <AuthGate>. NEVER ship only the marketing site or only the dashboard for a business-app brief — both surfaces must exist in the same plan.

If you plan a "Sidebar" or "DashboardPage" component for a feed/marketing/tool/game/content brief, that is a PLANNING ERROR — pick the right archetype instead.
If you plan ONLY a dashboard (no Hero/Pricing) or ONLY a landing page (no Dashboard/AuthCard) for a business-app brief, that is a PLANNING ERROR — both surfaces are required.

Component naming must reflect the domain (PostCard, Composer, FeedFilter, ContactsTable, Pipeline), not generic chrome (Dashboard, Sidebar, MainPanel).`;

interface PlanContext {
  /**
   * Rendered output of classifyAppShape(brief). When present, the planner
   * is told the category + surfaces so it picks the right archetype.
   */
  appShapeBlock?: string;
  /**
   * Rendered output of pickDesignDirection(). When present, the planner
   * knows the vibe so component counts/names align with the aesthetic.
   */
  designDirectionBlock?: string;
  /** Hint for the LAYOUT ARCHETYPE block — when known, we tell the model directly. */
  archetypeHint?: "feed" | "marketing" | "dashboard" | "tool" | "game" | "content" | "business-app";
}

function injectRootViewIfMissing(plan: PlannedFile[], brief: string): PlannedFile[] {
  // Drop forbidden paths the model may have planned despite the prompt.
  const cleaned = plan.filter(
    (f) =>
      f.path !== "index.html" &&
      f.path !== "src/main.tsx" &&
      f.path !== "src/styles.css" &&
      !f.path.startsWith("src/routes/"),
  );

  const hasRoot = cleaned.some((f) => f.path === "src/App.tsx");
  if (hasRoot) {
    // Make sure App.tsx is first so the scaffold renders it before its deps.
    const idx = cleaned.findIndex((f) => f.path === "src/App.tsx");
    if (idx > 0) {
      const [root] = cleaned.splice(idx, 1);
      cleaned.unshift(root);
    }
    return cleaned;
  }

  // Model forgot the root view. Inject it as file #1 with explicit deps on
  // every other planned component so the scaffold prompt tells it to wire
  // them up.
  const deps = cleaned.map((f) => f.path);
  const rootEntry: PlannedFile = {
    path: "src/App.tsx",
    purpose: `Root view — renders the full MVP shell with real domain UI for: ${brief.slice(0, 160)}. Import and use the listed component deps.`,
    deps,
    est_lines: 140,
  };
  return [rootEntry, ...cleaned];
}

/**
 * Cheap sanity check: catch the "I planned a dashboard for a feed" failure
 * mode where the model ignored the archetype block and emitted Sidebar +
 * DashboardPage anyway. Returns a list of offending paths.
 */
function detectArchetypeMismatch(
  files: PlannedFile[],
  archetype: PlanContext["archetypeHint"],
): string[] {
  if (!archetype) return [];
  // business-app handled below via missing-surface check, not banned names.
  if (archetype === "dashboard" || archetype === "business-app") return [];
  const bannedForNonDashboard =
    /(Sidebar|Dashboard(Page|Layout)?|AdminPanel|MainPanel)\b/;
  return files
    .map((f) => f.path)
    .filter((p) => bannedForNonDashboard.test(p));
}

/**
 * For business-app, both surfaces (marketing + product) must be present.
 * Returns a reason string if either side is missing, else null.
 */
function detectBusinessAppGap(files: PlannedFile[]): string | null {
  const paths = files.map((f) => f.path).join(" ");
  const hasMarketing = /(Hero|Landing|Pricing|Features|Testimonial|Faq|FAQ|Footer)/i.test(paths);
  const hasApp = /(Dashboard|AppShell|AuthCard|Sidebar|Settings|Workspace|Pipeline|Contacts|Wallet|Transactions|Inbox)/i.test(paths);
  if (!hasMarketing && !hasApp) return "missing_both_surfaces";
  if (!hasMarketing) return "missing_marketing_surface";
  if (!hasApp) return "missing_app_surface";
  return null;
}

export async function runStagePlan(args: {
  brief: string;
  hasBackend: boolean;
  context?: PlanContext;
}): Promise<StagePlanResult | StagePlanFailure> {
  try {
    const ctx = args.context ?? {};
    const archetypeLine = ctx.archetypeHint
      ? `\n\nARCHETYPE FOR THIS BRIEF: **${ctx.archetypeHint}**. Pick the matching layout from the rules above and reject components that contradict it.`
      : "";

    const contextBlocks = [
      ctx.appShapeBlock?.trim(),
      ctx.designDirectionBlock?.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    const upstream = await aiChatCompletions({
      feature: "generate",
      body: {
        // gemini-3.5-flash is a touch stronger than 3-flash-preview at
        // following multi-clause prompts (the archetype + design + rules
        // stack), still cheap, still fast. Worth the small bump.
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT + archetypeLine },
          {
            role: "user",
            content:
              `Brief: ${args.brief}\n\n` +
              `Backend connected: ${args.hasBackend ? "yes" : "no"}\n\n` +
              (contextBlocks ? `${contextBlocks}\n\n` : "") +
              `Plan the MVP file manifest now. Remember: src/App.tsx must be file #1, the archetype rules are HARD, and never plan index.html / src/main.tsx / src/styles.css.`,
          },
        ],
        tools: [PLAN_TOOL],
        tool_choice: { type: "function", function: { name: "emit_plan" } },
        max_tokens: 1200,
        stream: false,
      },
      timeoutTier: "default",
      meta: { phase: "plan", promptChars: args.brief.length },
    });

    if (!upstream.ok) {
      return { ok: false, reason: `upstream_${upstream.status}` };
    }

    const json = (await upstream.json()) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { ok: false, reason: "no_tool_call" };

    const parsed = JSON.parse(argsStr) as { summary?: string; files?: PlannedFile[] };
    if (!parsed.files?.length) return { ok: false, reason: "empty_plan" };

    let files = injectRootViewIfMissing(parsed.files, args.brief);

    // Hard-reject archetype mismatches: drop offending files so wire-up
    // doesn't ship a "Sidebar" component for a feed app. The scaffold
    // stage will still build the legitimate components.
    const mismatched = detectArchetypeMismatch(files, ctx.archetypeHint);
    if (mismatched.length > 0) {
      console.warn(
        `[stage-plan] archetype=${ctx.archetypeHint} but model planned ${mismatched.join(", ")} — dropping`,
      );
      files = files.filter((f) => !mismatched.includes(f.path));
      // Re-check the root view: dropping a dep doesn't invalidate App.tsx
      // but we want to make sure App.tsx didn't get dropped.
      if (!files.some((f) => f.path === "src/App.tsx")) {
        files = injectRootViewIfMissing(files, args.brief);
      }
    }

    return {
      ok: true,
      files,
      summary: parsed.summary?.trim() || "Planning your app",
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "plan_threw" };
  }
}
