/**
 * Inspector subagent — a cheap, read-only investigator.
 *
 * Before the expensive model touches code, the inspector goes and *looks*:
 * lists directories, greps for the user's exact words, reads the files that
 * actually matter. It cannot write anything. Its whole job is to come back
 * with a short briefing — which files, which lines, what's really there —
 * so the main model edits from evidence instead of memory.
 *
 * Runs on the budget tier: a handful of grep/read round trips is worth far
 * less than one wrong whole-file rewrite.
 */
import type { ProjectFile } from "@/server/generate.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  INSPECT_TOOLS,
  executeAgentTool,
  type ToolResult,
} from "@/server/agent-tools.server";

export interface InspectorStep {
  tool: string;
  label: string;
  isError?: boolean;
}

export interface InspectorReport {
  /** Markdown briefing for the main model. Empty when the run produced nothing. */
  briefing: string;
  /** Files the inspector concluded are relevant, most relevant first. */
  targetPaths: string[];
  steps: InspectorStep[];
  ok: boolean;
}

const MAX_TOOL_ROUNDS = 6;
const MODEL = "google/gemini-2.5-flash-lite";

const SYSTEM_PROMPT = `You are Petal's Inspector: a read-only investigator working inside a user's app codebase.

The user has asked for a change. Your job is NOT to make it — you cannot write files. Your job is to find the ground truth so another model can make the change correctly on the first try.

How to work:
1. Search for the user's exact words first. Quoted UI copy, button labels, headings and component names are the strongest signals — they usually appear verbatim in the source.
2. Once you find a candidate file, read the relevant region so you know exactly what is there.
3. Follow imports one hop when the real definition lives elsewhere (a section that renders a child component, a route that renders a page).
4. Stop as soon as you can name the files and lines that must change. Do not explore the whole project.

When you are done, reply with plain text only (no tool call) in this shape:

TARGETS: comma-separated file paths, most important first
FINDINGS:
- <file>:<line> — what is actually there right now
- ... one bullet per relevant location
RISKS: anything that would make a naive edit wrong (duplicate copy in several files, generated file, shared component used elsewhere). Write "none" if there are none.

Be concrete and short. Quote real code, never invent a path you have not seen.`;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function parseTargets(text: string): string[] {
  const match = text.match(/TARGETS:\s*(.+)/i);
  if (!match) return [];
  return match[1]
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^[-*`]+|[`.]+$/g, ""))
    .filter((s) => s.length > 0 && s.includes("/"))
    .slice(0, 8);
}

/**
 * Investigate a user request against the project. Never throws — a failed
 * inspection degrades to an empty report and the caller proceeds as before.
 */
export async function runInspector(args: {
  userRequest: string;
  files: ProjectFile[];
  projectId: string;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<InspectorReport> {
  const steps: InspectorStep[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `The user's request:\n"""\n${args.userRequest.slice(0, 4000)}\n"""\n\n` +
        `The project has ${args.files.length} files. Start by searching for the user's own words.`,
    },
  ];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await aiChatCompletions({
        feature: "triage",
        budgetAware: true,
        timeoutTier: "default",
        signal: args.signal,
        meta: { projectId: args.projectId, userId: args.userId ?? null },
        body: {
          model: MODEL,
          messages,
          tools: INSPECT_TOOLS,
          max_tokens: 1200,
          stream: false,
        },
      });

      if (!res.ok) {
        return { briefing: "", targetPaths: [], steps, ok: false };
      }

      const json = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const message = json.choices?.[0]?.message;
      const toolCalls = message?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const text = (message?.content ?? "").trim();
        return {
          briefing: text,
          targetPaths: parseTargets(text),
          steps,
          ok: text.length > 0,
        };
      }

      messages.push({
        role: "assistant",
        content: message?.content ?? "",
        tool_calls: toolCalls.map((tc, i) => ({
          id: tc.id ?? `call_${round}_${i}`,
          type: "function" as const,
          function: {
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "{}",
          },
        })),
      });

      for (const [i, tc] of toolCalls.entries()) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
        const result: ToolResult = await executeAgentTool({
          call: { name: tc.function?.name ?? "", args: parsedArgs },
          files: args.files,
          projectId: args.projectId,
          readOnly: true,
          signal: args.signal,
        });
        steps.push({
          tool: tc.function?.name ?? "unknown",
          label: result.label,
          isError: result.isError,
        });
        messages.push({
          role: "tool",
          tool_call_id: tc.id ?? `call_${round}_${i}`,
          content: result.output,
        });
      }
    }
  } catch (err) {
    console.warn("[inspector] run failed:", err instanceof Error ? err.message : err);
    return { briefing: "", targetPaths: [], steps, ok: false };
  }

  // Ran out of rounds without a conclusion — hand back whatever was learned.
  return {
    briefing: "",
    targetPaths: [],
    steps,
    ok: false,
  };
}

/** Render an inspector report as a prompt block for the main model. */
export function inspectorBriefingBlock(report: InspectorReport): string {
  if (!report.ok || !report.briefing.trim()) return "";
  return [
    "## Inspector findings (verified against the real project bytes)",
    "",
    "A read-only agent already searched the codebase for this request. These paths and",
    "line numbers are real — trust them over your own recollection, and edit exactly",
    "these locations unless the findings are clearly wrong.",
    "",
    report.briefing.trim(),
  ].join("\n");
}
