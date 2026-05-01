/**
 * Staged Pipeline — Stage 1: PLAN
 *
 * Asks a small/cheap model to emit a file MANIFEST for an MVP, NOT code.
 * The manifest is later consumed by Stage 2 (scaffold) which generates
 * each file in parallel, isolated calls. By splitting "what to build"
 * from "write the code", we eliminate two failure modes at once:
 *
 *   1. Truncation: each scaffold call only writes ONE file (~1.5–2K
 *      tokens), nowhere near the model's output ceiling.
 *   2. Prose-only bailout: this stage uses forced tool_choice and a
 *      tiny, well-defined output shape. The model can't drift into
 *      conversation.
 *
 * Status: shipped behind labs.staged_pipeline flag. The orchestrator
 * in src/routes/api/generate.ts only invokes this when the flag is on
 * for the requesting user. Off by default while telemetry confirms
 * the new path beats the monolithic one.
 *
 * This file is intentionally small and dependency-light so the stub
 * orchestrator can compile + run without dragging the full pipeline.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";

export interface PlannedFile {
  /** App-relative path, e.g. "src/routes/index.tsx". */
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
  /** Short rationale shown in build activity card. */
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
      "Emit a file manifest for an MVP. Cap at 8 files. Each file gets a path, a one-sentence purpose, its dependency list, and an estimated line count.",
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
          maxItems: 8,
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
          {
            role: "system",
            content:
              "You plan MVPs for a TanStack Start + Tailwind v4 web app. Always call emit_plan — never reply in prose. Cap at 8 files. Prefer one route file plus 3–6 components. Skip backend wiring unless explicitly required.",
          },
          {
            role: "user",
            content:
              `Brief: ${args.brief}\n\n` +
              `Backend connected: ${args.hasBackend ? "yes" : "no"}\n\n` +
              `Plan the MVP file manifest now.`,
          },
        ],
        tools: [PLAN_TOOL],
        tool_choice: { type: "function", function: { name: "emit_plan" } },
        max_tokens: 800,
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

    return {
      ok: true,
      files: parsed.files,
      summary: parsed.summary?.trim() || "Planning your app",
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "plan_threw" };
  }
}
