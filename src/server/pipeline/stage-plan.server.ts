/**
 * Staged Pipeline — Stage 1: PLAN
 *
 * Asks a small/cheap model to emit a file MANIFEST for an MVP, NOT code.
 * The manifest is later consumed by Stage 2 (scaffold) which generates
 * each file in parallel, isolated calls.
 *
 * CONTRACT (post-fix):
 *   - Target stack is Vite + React + TS + Tailwind v4 (NOT TanStack Start).
 *     The user-app kit mounts via src/main.tsx → <App /> in src/App.tsx.
 *   - src/App.tsx is ALWAYS the root view and is ALWAYS file #1 in the
 *     plan. If the model omits it, we inject it deterministically below.
 *   - index.html and src/main.tsx are Petal-owned and must NEVER appear
 *     in the plan — the renderable-shell guard writes them.
 *   - src/routes/* is NEVER planned — this is not TanStack.
 *
 * Why this matters: before the fix the plan stage's prompt mentioned
 * "TanStack Start" and the model would happily plan src/routes/index.tsx,
 * leaving no real root view. Stage 3 then shipped the "Your app is being
 * prepared" placeholder.
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

const PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_plan",
    description:
      "Emit a file manifest for an MVP. Cap at 10 files. Each file gets a path, a one-sentence purpose, its dependency list, and an estimated line count.",
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
          maxItems: 10,
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

const SYSTEM_PROMPT =
  "You plan MVPs for a Vite + React + TypeScript app using Tailwind v4 and the bundled shadcn UI kit at \"@/components/ui/*\". " +
  "Always call emit_plan — never reply in prose. Cap at 10 files. " +
  "RULES:\n" +
  "1. src/App.tsx is ALWAYS the root view and MUST be file #1 in the plan. It renders the full MVP shell (header, main content showing the actual feature, footer/nav). Never a placeholder.\n" +
  "2. Other files are components imported by src/App.tsx (e.g. src/components/PostList.tsx, src/components/ComposeForm.tsx). Aim for 3–7 components.\n" +
  "3. NEVER plan index.html or src/main.tsx — Petal writes those itself.\n" +
  "4. NEVER plan src/routes/* — this is NOT TanStack Start. Routing, if needed, lives inside src/App.tsx with simple state or react-router.\n" +
  "5. Skip backend wiring unless explicitly required by the brief.";

function injectRootViewIfMissing(plan: PlannedFile[], brief: string): PlannedFile[] {
  // Drop forbidden paths the model may have planned despite the prompt.
  const cleaned = plan.filter(
    (f) =>
      f.path !== "index.html" &&
      f.path !== "src/main.tsx" &&
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

export async function runStagePlan(args: {
  brief: string;
  hasBackend: boolean;
}): Promise<StagePlanResult | StagePlanFailure> {
  try {
    const upstream = await aiChatCompletions({
      feature: "generate",
      body: {
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Brief: ${args.brief}\n\n` +
              `Backend connected: ${args.hasBackend ? "yes" : "no"}\n\n` +
              `Plan the MVP file manifest now. Remember: src/App.tsx must be file #1.`,
          },
        ],
        tools: [PLAN_TOOL],
        tool_choice: { type: "function", function: { name: "emit_plan" } },
        max_tokens: 1000,
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

    const files = injectRootViewIfMissing(parsed.files, args.brief);

    return {
      ok: true,
      files,
      summary: parsed.summary?.trim() || "Planning your app",
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "plan_threw" };
  }
}
