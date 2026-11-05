/**
 * Layer 5 — Self-Recovery.
 *
 * Two best-effort post-build checks that turn Kimble from "ship and hope"
 * into something that notices when it's drifted from the brief.
 *
 *  1. runSelfCheck — after a successful build, asks a small model to
 *     rate the result against the user's brief on a few concrete axes
 *     and produce 0–3 short follow-up suggestions the user can tap.
 *     Surfaced via a `self_check` SSE event (rendered as suggestion
 *     chips, mirroring Layer 1's clarify chips).
 *
 *  2. humanizeBuildError — when generation throws, rewrites the raw
 *     internal error string into a friendly one-liner the user can act
 *     on, plus 0–3 retry/fix suggestions. Falls back to the original
 *     message if the model is unavailable or returns garbage.
 *
 * Both calls are bounded (1500 char inputs, sub-second model) and
 * never block the user's reply on success — failure means we just emit
 * nothing extra. Cost is negligible vs. the main build.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import { defaultUtilityModel } from "@/lib/ai-model-config";
import type { ErrorKind } from "@/server/generate.server";

// Short classification work — the central utility tier owns the actual slug.
const HUMANIZE_MODEL = defaultUtilityModel();

/* ──────────────────────────────────────────────────────────────────────
 * 0. Server-side raw-error classifier
 *
 * Runs ONCE at the catch site, against the raw exception, BEFORE any
 * humanization. Produces a stable structured `kind` the client uses to
 * pick the right friendly card — no more regexing our own LLM-rewritten
 * apology prose, which was the root cause of the "your message is too
 * long" misclassification on tiny prompts.
 *
 * When in doubt, return "unknown". The client falls back to the generic
 * card and reportPipelineFailure logs it so we can add a new branch.
 * ────────────────────────────────────────────────────────────────────── */

export function classifyRawError(rawMessage: string): ErrorKind {
  const t = (rawMessage || "").toString();

  // Order matters: more specific first.
  //
  // NOTE: We intentionally do NOT regex for "aborted" / "cancelled" here.
  // Those words appear in many non-user-initiated failures (AbortError from
  // upstream gateway timeouts, "stream aborted by provider", "request
  // aborted: tool_call missing", etc.) and inferring user intent from text
  // produces the "You stopped Kimble" misattribution we hit in the wild.
  // True user-cancel must be set by the catch site from
  // `request.signal.aborted` — never inferred from prose. Until that's
  // wired, "aborted" is only emitted when the catch site sets it explicitly.
  if (/\b401\b|unauthori[sz]ed|not signed in/i.test(t)) return "unauthorized";
  if (/rate.?limit|\b429\b/i.test(t)) return "rate_limit";
  // Provider-side exhaustion FIRST. When Kimble's own model gateway runs dry
  // it says "AI credits exhausted … Settings → Workspace → Usage" — that is
  // OUR account, not the user's wallet. Telling the user to buy credits for
  // an outage we caused is both wrong and unfixable by them.
  if (/settings\s*(?:→|->|>)\s*workspace\s*(?:→|->|>)\s*usage|ai credits exhausted/i.test(t))
    return "provider_credits_exhausted";
  if (/credits?.*(exhaust|out|empty|low)|\b402\b|insufficient.*(credit|balance)/i.test(t))
    return "credits_exhausted";

  // Worker / fetch wall-clock timeout. AbortSignal.timeout fires a
  // TimeoutError whose message is "The operation was aborted due to
  // timeout"; some runtimes also surface "signal timed out". This is
  // distinct from a true 504 Gateway Timeout (handled below) — the
  // upstream never responded at all because we cancelled.
  if (/operation was aborted due to timeout|signal timed out|\bTimeoutError\b|fetch.*timeout/i.test(t))
    return "upstream_timeout";
  if (/\b(50[234])\b|bad gateway|upstream|service unavailable|gateway timeout|AI gateway/i.test(t))
    return "upstream_unavailable";
  if (/response was cut off|cut off before|finish(ed)? reason.*(length|max_tokens)|max_tokens|truncated.*json|unexpected end of json/i.test(t))
    return "truncated_response";
  if (/staged_pipeline:|final syntax check failed|final parse guard|safety check|verifier|esbuild_parse_failed|local_verifier_fatal/i.test(t))
    return "generation_incomplete";
  // The "model returned prose, not files" family — these are RAW pipeline
  // strings (parseCollectedProject, write_project guard), NOT humanized
  // copy. Humanized phrases like "hit a snag" do NOT belong here.
  if (/returned no ops|usable edits|invalid edit data|patch_files|edits must be incremental patches/i.test(t))
    return "no_edit_emitted";
  if (/invalid project data|did not return a project|returned no files|tool_call.*missing|no write_project/i.test(t))
    return "no_files_emitted";
  return "unknown";
}

/**
 * Is this failure one Kimble can simply run again?
 *
 * Transient = the model call, the network or the worker fell over. Those are
 * picked back up silently instead of being reported. Anything the user has to
 * act on (out of credits, signed out, they pressed stop) is NOT transient and
 * still surfaces normally.
 */
const TRANSIENT_KINDS = new Set<ErrorKind>([
  "upstream_timeout",
  "upstream_unavailable",
  "rate_limit",
  "truncated_response",
]);

const TRANSIENT_RAW =
  /fetch failed|network error|load failed|socket hang up|terminated|stream idle|ECONNRESET|ETIMEDOUT|ENOTFOUND|connection (closed|reset|dropped)|worker (restart|exceeded)|request stole it|error code:\s*1016/i;

export function isTransientFailure(
  kind: ErrorKind,
  rawMessage: string,
  userCancelled = false,
): boolean {
  if (userCancelled) return false;
  if (
    kind === "credits_exhausted" ||
    kind === "provider_credits_exhausted" ||
    kind === "unauthorized" ||
    kind === "aborted"
  ) {
    return false;
  }
  if (TRANSIENT_KINDS.has(kind)) return true;
  return TRANSIENT_RAW.test(rawMessage || "");
}



/* ──────────────────────────────────────────────────────────────────────
 * 1. Self-check on success
 * ────────────────────────────────────────────────────────────────────── */

export type FriendlyError = {
  /** Plain-English replacement for the raw error. ≤ 200 chars. */
  message: string;
  /** 0–3 short retry/fix prompts the user could tap. */
  suggestions: string[];
};

const HUMANIZE_SYSTEM = `You translate raw build errors from Kimble (an AI app builder) into ONE friendly sentence the user can act on, plus 0–3 short follow-up prompts they could tap to recover.

Audience: non-technical builders. NEVER mention file paths, stack traces, model names, tokens, JSON schemas, or "the AI" as a third party. Speak as Kimble, in first person, calm and accountable: "I couldn't…", "Let me try…".

Rules:
- message: ONE sentence, ≤ 200 chars, plain English, no code. Avoid words like "tool call", "schema", "tokens", "endpoint".
- suggestions: 0–3 SHORT prompts the user could send next, ≤ 8 words each, written as the user would phrase them ("Try again", "Make it simpler", "Just a landing page").
- If the error is clearly about credits / payment, keep the message and suggest top-up — DO NOT invent a retry.
- If the error is vague ("Generation failed."), still produce a kind one-liner and suggest "Try again" + a smaller scope.

Call the "humanize_error" tool exactly once.`;

const HUMANIZE_TOOL = {
  type: "function" as const,
  function: {
    name: "humanize_error",
    description: "Rewrite a raw build error as a friendly, actionable message.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string" },
        suggestions: { type: "array", maxItems: 3, items: { type: "string" } },
      },
      required: ["message", "suggestions"],
    },
  },
};

/**
 * Rewrite a raw error into something a non-technical user can act on.
 * Falls back to the original message (with empty suggestions) on any
 * failure so the user always sees SOMETHING.
 */
export async function humanizeBuildError(args: {
  rawMessage: string;
  brief: string;
}): Promise<FriendlyError> {
  const fallback: FriendlyError = {
    message: args.rawMessage || "Something went wrong on my end.",
    suggestions: [],
  };

  if (!process.env.LOVABLE_API_KEY) return fallback;

  const raw = (args.rawMessage ?? "").trim().slice(0, 1500);
  if (!raw) return fallback;

  const userPrompt =
    `RAW ERROR:\n"""${raw}"""\n\n` +
    `WHAT THE USER ASKED FOR:\n"""${(args.brief ?? "").trim().slice(0, 600)}"""\n\n` +
    `Rewrite this for the user now.`;

  try {
    const resp = await aiChatCompletions({
      feature: "recovery",
      body: {
        model: HUMANIZE_MODEL,
        messages: [
          { role: "system", content: HUMANIZE_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [HUMANIZE_TOOL],
        tool_choice: { type: "function", function: { name: "humanize_error" } },
      },
      // Wording helper only — the raw message is already a safe fallback.
      noFallback: true,
    });

    if (!resp.ok) return fallback;
    const json = (await resp.json()) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return fallback;
    const parsed = JSON.parse(argsStr) as FriendlyError;
    const message = (parsed?.message ?? "").trim().slice(0, 240);
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 3)
      : [];
    return message ? { message, suggestions } : fallback;
  } catch (e) {
    console.warn("[humanize-error] threw:", e);
    return fallback;
  }
}
