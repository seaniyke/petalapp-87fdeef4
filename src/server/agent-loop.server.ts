/**
 * Petal's multi-round agent loop — the "work before you write" phase.
 *
 * The final generation call is, and stays, a single forced `patch_files` /
 * `write_project` emit. That's deliberate: every downstream stage (streaming
 * relay, op parsing, apply, recovery, repairs, honesty ledger) is built around
 * exactly one structured payload per turn, and threading a live tool loop
 * through the streaming path would put all of that at risk for no user-visible
 * gain.
 *
 * What was actually missing is the phase *before* that emit. Until now the
 * model got one static snapshot of the project and had to guess. Here it gets
 * hands: it can grep, read, run a real codemod on a real checkout, and run the
 * verifier — as many rounds as it needs — and only then does the emit call run,
 * with the full transcript of what it learned appended to its context.
 *
 * Codemod writes are applied to a working copy and returned to the caller.
 * The caller decides whether to adopt them; this module never mutates its
 * input.
 */
import type { ProjectFile } from "@/server/generate.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  allAgentTools,
  executeAgentTool,
  applyToolChanges,
  type ToolSpec,
} from "@/server/agent-tools.server";

export interface AgentLoopStep {
  tool: string;
  label: string;
  isError?: boolean;
}

export interface AgentLoopResult {
  /** Assistant/tool turns to append to the emit call's message list. */
  transcript: ChatMessage[];
  /** Timeline steps, in order, for the builder UI. */
  steps: AgentLoopStep[];
  /** Project state after any codemods. Same array identity when nothing ran. */
  files: ProjectFile[];
  /** Paths a codemod actually moved. */
  changedPaths: string[];
  /** Rounds actually spent. */
  rounds: number;
  /** True when the loop ended because the model was satisfied, not truncated. */
  converged: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** Hard ceilings. A wedged loop must cost a bounded amount of money and time. */
const MAX_ROUNDS = 5;
const MAX_TOOL_CALLS = 14;
const MAX_CODEMODS = 3;
/** Installs hit the network and mutate the manifest; two per turn is plenty. */
const MAX_INSTALLS = 2;
/** A suite run costs minutes, so it happens at most once per turn. */
const MAX_TEST_RUNS = 1;

const LOOP_BRIEF = `You now have tools, and a chance to do real work before you write your final answer.

Use them for what you cannot know from the snapshot above:
- \`search_files\` / \`read_file\` — confirm the exact current bytes of anything you are about to rewrite. Never write a search/replace against text you have not just read.
- \`run_script\` — run a Node or Python script against a real checkout of the project. Use it for mechanical, repetitive edits spanning many files (renaming a prop everywhere, swapping a class across every page, rewriting every import). Anything it writes to disk is applied to the project. Keep it deterministic and idempotent, and print a one-line summary of what it changed.
- \`run_check\` — run the static verifier. Call it after any codemod.
- \`install_packages\` — add an npm dependency on a real checkout. Use this instead of hand-writing a version into package.json when the change needs a package the project does not have. Prefer zero new dependencies; only install what the request genuinely requires.
- \`run_tests\` — run the project's OWN test suite. Slow. Only when the project has tests AND your change could plausibly break them.

Rules:
- Prefer one codemod over twenty hand-written edits, and one hand-written edit over a codemod that touches one file.
- Do not explore for its own sake. Stop as soon as you know what to do.
- When you are done with tools, STOP CALLING THEM. Reply with a one-line plan and nothing else. You will then be asked for the final structured edit, and any file your codemod already fixed must NOT be edited again.`;

function toolsForLoop(): ToolSpec[] {
  return allAgentTools();
}

function summarizeForPrompt(result: AgentLoopResult): string {
  if (result.steps.length === 0) return "";
  const lines = result.steps.map((s) => `- ${s.label}${s.isError ? " (failed)" : ""}`);
  const changed = result.changedPaths.length
    ? [
        "",
        "A codemod has ALREADY been applied to these files, and the project state shown to you above is now stale for them:",
        ...result.changedPaths.map((p) => `- ${p}`),
        "",
        "Do NOT re-edit those files unless something is still wrong with them. Emit ops only for what remains.",
      ]
    : [];
  return [
    "## Work already done this turn",
    "",
    ...lines,
    ...changed,
  ].join("\n");
}

/**
 * Run the tool loop. Never throws: any failure returns whatever was learned so
 * far, and the caller proceeds exactly as it did before this phase existed.
 */
export async function runAgentLoop(args: {
  model: string;
  /** The fully assembled emit-call messages, used verbatim as the loop's context. */
  messages: ChatMessage[];
  files: ProjectFile[];
  projectId: string;
  userId?: string | null;
  signal?: AbortSignal;
  maxRounds?: number;
  onStep?: (step: AgentLoopStep) => void;
}): Promise<AgentLoopResult> {
  const steps: AgentLoopStep[] = [];
  const transcript: ChatMessage[] = [];
  let files = args.files;
  const changedPaths: string[] = [];
  let toolCallCount = 0;
  let codemodCount = 0;
  let installCount = 0;
  let testRunCount = 0;
  let rounds = 0;
  let converged = false;

  const maxRounds = Math.max(1, Math.min(args.maxRounds ?? MAX_ROUNDS, MAX_ROUNDS));
  const working: ChatMessage[] = [
    ...args.messages,
    { role: "user", content: LOOP_BRIEF },
  ];

  try {
    for (rounds = 1; rounds <= maxRounds; rounds++) {
      const res = await aiChatCompletions({
        feature: "generate",
        timeoutTier: "default",
        signal: args.signal,
        meta: { projectId: args.projectId, userId: args.userId ?? null, phase: "agent_loop" },
        body: {
          model: args.model,
          messages: working,
          tools: toolsForLoop(),
          // Never forced: the model must be free to say "I have seen enough".
          tool_choice: "auto",
          max_tokens: 2400,
          stream: false,
        },
      });

      if (!res.ok) {
        console.warn(`[agent-loop] upstream ${res.status} on round ${rounds} — skipping loop`);
        break;
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
        converged = true;
        break;
      }

      const assistantTurn: ChatMessage = {
        role: "assistant",
        content: message?.content ?? "",
        tool_calls: toolCalls.map((tc, i) => ({
          id: tc.id ?? `loop_${rounds}_${i}`,
          type: "function" as const,
          function: {
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "{}",
          },
        })),
      };
      working.push(assistantTurn);
      transcript.push(assistantTurn);

      for (const [i, tc] of toolCalls.entries()) {
        const id = tc.id ?? `loop_${rounds}_${i}`;
        const name = tc.function?.name ?? "";
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
        } catch {
          parsed = {};
        }

        // Budget guards. Refusals go back to the model as tool output so it
        // can adapt, rather than being silently dropped.
        let refusal: string | null = null;
        if (toolCallCount >= MAX_TOOL_CALLS) {
          refusal = "Tool budget for this turn is spent. Stop calling tools and write the edit now.";
        } else if (name === "run_script" && codemodCount >= MAX_CODEMODS) {
          refusal = "Codemod budget for this turn is spent. Make any remaining changes as normal edits.";
        } else if (name === "install_packages" && installCount >= MAX_INSTALLS) {
          refusal =
            "Install budget for this turn is spent. Work with the dependencies the project already has.";
        } else if (name === "run_tests" && testRunCount >= MAX_TEST_RUNS) {
          refusal = "The test suite has already run this turn. Do not run it again.";
        }

        if (refusal) {
          const msg: ChatMessage = { role: "tool", tool_call_id: id, content: refusal };
          working.push(msg);
          transcript.push(msg);
          continue;
        }

        toolCallCount++;
        if (name === "run_script") codemodCount++;
        if (name === "install_packages") installCount++;
        if (name === "run_tests") testRunCount++;

        const result = await executeAgentTool({
          call: { name, args: parsed },
          files,
          projectId: args.projectId,
          readOnly: false,
          signal: args.signal,
        });

        if (result.changedFiles?.length || result.deletedPaths?.length) {
          const applied = applyToolChanges(
            files,
            result.changedFiles ?? [],
            result.deletedPaths ?? [],
          );
          files = applied.files;
          for (const p of applied.changedPaths) {
            if (!changedPaths.includes(p)) changedPaths.push(p);
          }
        }

        const step: AgentLoopStep = {
          tool: name || "unknown",
          label: result.label,
          isError: result.isError,
        };
        steps.push(step);
        args.onStep?.(step);

        const msg: ChatMessage = { role: "tool", tool_call_id: id, content: result.output };
        working.push(msg);
        transcript.push(msg);
      }
    }
  } catch (err) {
    console.warn("[agent-loop] failed:", err instanceof Error ? err.message : err);
  }

  return {
    transcript,
    steps,
    files,
    changedPaths,
    rounds: Math.min(rounds, maxRounds),
    converged,
  };
}

export { summarizeForPrompt as agentLoopSummaryBlock };

/**
 * Is this turn worth a tool loop?
 *
 * The loop costs extra round trips, so it only runs where it demonstrably pays
 * for itself: work that spans many files, or mechanical/repetitive edits where
 * a script beats hand-written ops. A one-line copy tweak that the deterministic
 * resolver already pinned gets nothing out of it and must stay fast.
 */
export function shouldRunAgentLoop(args: {
  isInitial: boolean;
  isCrossCutting: boolean;
  prompt: string;
  fileCount: number;
}): boolean {
  if (args.isInitial) return false;
  if (args.fileCount < 2) return false;
  if (args.isCrossCutting) return true;

  const p = args.prompt.toLowerCase();
  const mechanical = [
    "every page",
    "all pages",
    "everywhere",
    "across the app",
    "all components",
    "each file",
    "every file",
    "all files",
    "rename",
    "replace all",
    "find and replace",
    "consistent",
    "throughout",
    "site-wide",
    "sitewide",
    "app-wide",
    "bulk",
    "migrate",
    "refactor",
  ];
  return mechanical.some((k) => p.includes(k));
}
