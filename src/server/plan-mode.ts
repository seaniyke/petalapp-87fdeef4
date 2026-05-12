/**
 * Plan Mode v1 — server-side planning + scope-cap helpers.
 *
 * When the user toggles "Plan first" in the composer, /api/generate calls
 * `proposeChangePlan()` BEFORE the heavy generation. The model returns a
 * compact JSON plan describing which files it intends to touch and why.
 * We persist that plan, emit a `plan_proposed` SSE event, and end the
 * stream early. The composer renders the plan as an approval card.
 *
 * On approve, the client POSTs back to /api/generate with
 * `{ approvedPlanId, allowedPaths }`. The plan is loaded, intersected
 * against `allowedPaths` (so the user can uncheck files), and the file
 * list is used as a scope cap inside `isProtectedPath` — the same gate
 * that already blocks managed scaffold paths and PETAL.md globs.
 *
 * Storage: Supabase table `petal_plans` with RLS scoped to `user_id`.
 */

import { aiChatCompletions } from "./ai-provider.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ChatMessage, ProjectFile } from "./generate.server";

/** Risk tag the model assigns to its own plan. Drives the badge color. */
export type PlanRisk = "low" | "medium" | "high";
/** Per-file intent — matches FileOp.op so downstream code can reuse it. */
export type PlanFileIntent = "edit" | "create" | "delete";

export type PlanFile = {
  path: string;
  intent: PlanFileIntent;
  /** One short sentence the user will see in the plan card. */
  reason: string;
};

export type PlanProposal = {
  /** ≤140 chars human summary of what the change does. */
  summary: string;
  files: PlanFile[];
  risk: PlanRisk;
};

const PLAN_MODEL = "google/gemini-3-flash-preview";
const PLAN_MAX_FILES = 24;

const PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "propose_change_plan",
    description:
      "Propose a scoped change plan describing which files you intend to touch and why. Do NOT write code yet — only declare scope.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One sentence (<=140 chars) describing what this change does for the user.",
        },
        files: {
          type: "array",
          minItems: 1,
          maxItems: PLAN_MAX_FILES,
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Project-relative file path." },
              intent: { type: "string", enum: ["edit", "create", "delete"] },
              reason: {
                type: "string",
                description: "One short sentence why this file is in scope.",
              },
            },
            required: ["path", "intent", "reason"],
            additionalProperties: false,
          },
        },
        risk: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "low: cosmetic/local. medium: multi-file or behavior change. high: structural / data model / auth.",
        },
      },
      required: ["summary", "files", "risk"],
      additionalProperties: false,
    },
  },
};

const PLAN_SYSTEM_PROMPT = `You are Petal's planning step.

You are NOT writing code. You are deciding the SMALLEST set of files needed to satisfy the user's request, then returning a structured plan via the propose_change_plan tool.

Rules:
- List ONLY files you will actually edit, create, or delete. No "maybe".
- Prefer the smallest complete batch. Single edits should stay 1-3 files; multi-part requests may include every required file up to ${PLAN_MAX_FILES}.
- If the user asks for multiple edits, decompose the request and include the full coordinated scope instead of dropping items from the batch.
- Never list files under: src/components/ui/, src/integrations/backend/, src/integrations/supabase/, vite.config.ts, tsconfig.json. They are protected.
- Use the EXACT file paths shown in the manifest. Do not invent paths.
- "reason" is one short sentence the END USER will read. No jargon.
- Risk: low = cosmetic/local edit. medium = multi-file behaviour change. high = data model / auth / structural rewrites.

Always call the tool. Never reply in prose.`;

export type ProposePlanArgs = {
  userPrompt: string;
  history: ChatMessage[];
  currentFiles: ProjectFile[];
  signal?: AbortSignal;
};

function fileManifest(files: ProjectFile[]): string {
  if (files.length === 0) return "(empty project — first build)";
  return files
    .filter(
      (f) =>
        !f.path.startsWith("src/components/ui/") &&
        !f.path.startsWith("src/integrations/") &&
        !f.path.startsWith("src/components/blocks/") &&
        !f.path.startsWith("src/components/examples/") &&
        !f.path.startsWith("src/components/mobile/"),
    )
    .slice(0, 80)
    .map((f) => `- ${f.path} (${f.content.split("\n").length} lines)`)
    .join("\n");
}

/**
 * Call the cheap planning model. Returns a parsed PlanProposal.
 * Throws on any failure — caller decides whether to fall back to no-plan-mode.
 */
export async function proposeChangePlan(args: ProposePlanArgs): Promise<PlanProposal> {
  const manifest = fileManifest(args.currentFiles);
  const recentHistory = args.history
    .slice(-6)
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => `${m.role.toUpperCase()}: ${(m.content as string).slice(0, 600)}`)
    .join("\n");

  const userBlock = [
    "## Current project files",
    manifest,
    "",
    recentHistory ? "## Recent conversation" : "",
    recentHistory,
    "",
    "## New user request",
    args.userPrompt,
    "",
    "Call propose_change_plan with the smallest viable scope.",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await aiChatCompletions({
    feature: "generate",
    body: {
      model: PLAN_MODEL,
      messages: [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: userBlock },
      ],
      tools: [PLAN_TOOL],
      tool_choice: { type: "function", function: { name: "propose_change_plan" } },
      stream: false,
    },
    signal: args.signal,
    meta: { phase: "discuss", chosenBy: "plan_mode" },
  });

  if (!resp.ok) {
    throw new Error(`plan_proposal_upstream_${resp.status}`);
  }
  const json = (await resp.json()) as {
    choices?: Array<{
      message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
    }>;
  };
  const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("plan_proposal_no_tool_call");

  let parsed: PlanProposal;
  try {
    parsed = JSON.parse(argsStr) as PlanProposal;
  } catch {
    throw new Error("plan_proposal_invalid_json");
  }
  if (!parsed.files?.length) throw new Error("plan_proposal_empty_files");

  // Defense: drop any obviously protected path the model snuck in.
  parsed.files = parsed.files.filter(
    (f) =>
      !f.path.startsWith("src/components/ui/") &&
      !f.path.startsWith("src/integrations/backend/") &&
      !f.path.startsWith("src/integrations/supabase/") &&
      f.path !== "vite.config.ts" &&
      f.path !== "tsconfig.json",
  );
  if (!parsed.files.length) throw new Error("plan_proposal_only_protected_paths");

  // Cap fields defensively before persisting / displaying.
  parsed.summary = (parsed.summary || "").slice(0, 240);
  parsed.files = parsed.files.slice(0, PLAN_MAX_FILES).map((f) => ({
    path: f.path,
    intent: f.intent,
    reason: (f.reason || "").slice(0, 200),
  }));
  if (parsed.risk !== "low" && parsed.risk !== "medium" && parsed.risk !== "high") {
    parsed.risk = "medium";
  }
  return parsed;
}

/** Persist a proposed plan. Returns the row id used as the approval token. */
export async function savePlan(opts: {
  projectId: string;
  userId: string;
  payload: PlanProposal;
}): Promise<string> {
  // Cast through `any` because the table was just added by migration and the
  // generated Database types haven't been regenerated yet.
  const client = supabaseAdmin as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
      };
    };
  };
  const { data, error } = await client
    .from("petal_plans")
    .insert({
      project_id: opts.projectId,
      user_id: opts.userId,
      payload: opts.payload as unknown as Record<string, unknown>,
      status: "proposed",
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    throw new Error(`plan_save_failed: ${error?.message ?? "unknown"}`);
  }
  return data.id as string;
}

/**
 * Load a previously-saved plan and verify ownership + freshness. Returns the
 * payload and the canonical path list. Throws on missing / expired / wrong-user.
 */
export async function loadAndConsumePlan(opts: {
  planId: string;
  userId: string;
}): Promise<{ payload: PlanProposal; allowedPathsCanonical: string[] }> {
  const client = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{
            data:
              | {
                  id: string;
                  user_id: string;
                  payload: unknown;
                  status: string;
                  expires_at: string | null;
                }
              | null;
            error: { message: string } | null;
          }>;
        };
      };
      update: (row: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<unknown>;
      };
    };
  };
  const { data, error } = await client
    .from("petal_plans")
    .select("id, user_id, payload, status, expires_at")
    .eq("id", opts.planId)
    .maybeSingle();
  if (error || !data) throw new Error("plan_not_found");
  if (data.user_id !== opts.userId) throw new Error("plan_wrong_user");
  if (data.status !== "proposed") throw new Error(`plan_already_${data.status}`);
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    throw new Error("plan_expired");
  }
  const payload = data.payload as unknown as PlanProposal;
  // Mark as approved (best-effort; not fatal if it races).
  void client.from("petal_plans").update({ status: "approved" }).eq("id", opts.planId);
  return {
    payload,
    allowedPathsCanonical: payload.files.map((f) => f.path),
  };
}

/**
 * Produce a Set<string> for O(1) scope checks. The intersection with the
 * user's checkbox-edited list happens here too — a path must be in BOTH the
 * original plan AND the user's allow-list to pass.
 */
export function buildAllowedPathSet(
  planPaths: string[],
  userAllowed: string[] | undefined,
): Set<string> {
  if (!userAllowed || userAllowed.length === 0) return new Set(planPaths);
  const userSet = new Set(userAllowed);
  return new Set(planPaths.filter((p) => userSet.has(p)));
}

/**
 * Render a short instruction block injected into the patch system prompt
 * once a plan is approved. Tells the model "you previously proposed this
 * plan; stick to these files; don't expand scope."
 */
export function renderApprovedPlanBlock(plan: PlanProposal): string {
  const list = plan.files.map((f) => `- [${f.intent}] ${f.path} — ${f.reason}`).join("\n");
  return `\n\n### Approved plan (locked scope)\nThe user has APPROVED this plan. You MUST limit your file operations to the paths below. Do NOT touch any other file. If satisfying the request truly requires a file outside this list, return a brief summary explaining why and emit no file ops.\n\nSummary: ${plan.summary}\nRisk: ${plan.risk}\n\nFiles:\n${list}\n`;
}
