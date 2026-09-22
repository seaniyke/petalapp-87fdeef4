/**
 * Prompt budgeting and provider-error classification.
 *
 * Root cause of the "Kimble couldn't pin down a safe change" turns:
 *
 *  1. The prompt had no ceiling. `trimFilesForPrompt` budgeted in CHARACTERS,
 *     and any pinned/target file was exempted from the budget entirely, so a
 *     "small" edit on a 356-file app could send a large fraction of the code.
 *  2. The model service refused the oversized request with an error frame
 *     inside a 200 stream, which the SSE reader silently skipped — so the turn
 *     looked empty, and the identical request was fired twice more.
 *
 * This module owns the two primitives that fix both: a token estimate with a
 * hard ceiling, and a classifier for provider error frames. Pure, no I/O.
 */

/* ------------------------------------------------------------------ */
/* Token estimation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Cheap token estimate. Source code averages ~3.4 chars/token across the
 * models we run; we deliberately round DOWN the divisor (i.e. over-estimate
 * tokens) so the ceiling errs on the side of sending less.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.2);
}

/** Context window per model, in tokens. Conservative, not marketing numbers. */
const CONTEXT_WINDOWS: Array<{ match: RegExp; tokens: number }> = [
  { match: /deepseek/i, tokens: 128_000 },
  { match: /gemini/i, tokens: 200_000 },
  { match: /gpt-5|gpt-4|openai/i, tokens: 128_000 },
  { match: /claude/i, tokens: 200_000 },
];

export function contextWindowFor(model: string | null | undefined): number {
  const hit = CONTEXT_WINDOWS.find((c) => c.match.test(model ?? ""));
  return hit?.tokens ?? 128_000;
}

/**
 * How many prompt tokens a turn may spend: the model's window, minus the
 * output reservation, minus a safety margin for the parts we don't measure
 * (tool schema, system prefix rendered later, SSE overhead).
 */
export function promptTokenCeiling(args: {
  model: string | null | undefined;
  completionBudgetTokens: number;
}): number {
  const window = contextWindowFor(args.model);
  const reserve = Math.max(4_000, args.completionBudgetTokens);
  const safety = Math.round(window * 0.12);
  return Math.max(8_000, window - reserve - safety);
}

/* ------------------------------------------------------------------ */
/* Anchored windows — send the part, not the whole file                 */
/* ------------------------------------------------------------------ */

export interface AnchorWindowOptions {
  /** 1-based line numbers of interest inside the file. */
  lines: number[];
  /** Lines of context kept on each side of an anchor. */
  pad?: number;
  /** Never emit a window longer than this many lines. */
  maxLines?: number;
}

/**
 * Extract the regions of `content` around `lines`, merging overlaps and
 * marking each elision so the model can see the file is partial and knows the
 * real line numbers of everything it CAN see.
 *
 * Unlike head-truncation (the previous behaviour) this keeps the tail of a
 * file reachable, which is why `replace` snippets used to miss.
 */
export function anchoredWindows(content: string, opts: AnchorWindowOptions): string {
  const lines = content.split("\n");
  const pad = opts.pad ?? 40;
  const maxLines = opts.maxLines ?? 400;
  const anchors = [...new Set(opts.lines)].filter((n) => n >= 1 && n <= lines.length).sort((a, b) => a - b);
  if (anchors.length === 0) return content;

  // Build padded ranges, then merge any that touch or overlap.
  const ranges: Array<[number, number]> = [];
  for (const line of anchors) {
    const start = Math.max(1, line - pad);
    const end = Math.min(lines.length, line + pad);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  // Trim from the end if the windows together exceed the ceiling.
  let budget = maxLines;
  const kept: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    if (budget <= 0) break;
    const span = end - start + 1;
    if (span <= budget) {
      kept.push([start, end]);
      budget -= span;
    } else {
      kept.push([start, start + budget - 1]);
      budget = 0;
    }
  }
  if (kept.length === 0) return content;

  // Whole file already fits — don't bother slicing it.
  if (kept.length === 1 && kept[0]![0] === 1 && kept[0]![1] === lines.length) return content;

  const out: string[] = [];
  let cursor = 1;
  for (const [start, end] of kept) {
    if (start > cursor) out.push(`/* … lines ${cursor}-${start - 1} unchanged, not shown … */`);
    out.push(`/* lines ${start}-${end} */`);
    out.push(lines.slice(start - 1, end).join("\n"));
    cursor = end + 1;
  }
  if (cursor <= lines.length) {
    out.push(`/* … lines ${cursor}-${lines.length} unchanged, not shown … */`);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Provider error frames                                                */
/* ------------------------------------------------------------------ */

export type ProviderErrorKind =
  | "context_overflow"
  | "capacity"
  | "schema_rejected"
  | "auth"
  | "unknown";

export interface ProviderError {
  kind: ProviderErrorKind;
  /** Upstream code when present (HTTP-ish, or a provider string). */
  code: string | null;
  message: string;
}

/**
 * Recognise an OpenRouter / OpenAI-compatible error frame.
 *
 * OpenRouter reports upstream failures as a 200 SSE stream carrying
 * `{"error": {...}}` with no `choices`. The reader used to skip that frame,
 * which is exactly why a refused turn looked like an empty one.
 */
export function readErrorFrame(json: unknown): ProviderError | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: unknown }).error;
  if (!err) return null;
  if (typeof err === "string") return classifyProviderError(err, null);
  if (typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown; type?: unknown; metadata?: unknown };
    const message =
      typeof e.message === "string" && e.message
        ? e.message
        : JSON.stringify(err).slice(0, 500);
    const rawCode = e.code ?? e.type ?? null;
    const code = rawCode == null ? null : String(rawCode);
    const meta =
      e.metadata && typeof e.metadata === "object"
        ? JSON.stringify(e.metadata).slice(0, 300)
        : "";
    return classifyProviderError(`${message} ${meta}`.trim(), code);
  }
  return null;
}

export function classifyProviderError(message: string, code: string | null): ProviderError {
  const m = message.toLowerCase();
  const c = (code ?? "").toLowerCase();

  const kind: ProviderErrorKind =
    /context|too (?:long|large|many tokens)|maximum context|token limit|exceeds? the (?:model|context)|prompt is too/.test(m)
      ? "context_overflow"
      : /rate.?limit|429|overloaded|capacity|temporarily unavailable|no (?:available )?(?:endpoints|providers)|timeout|503|502|upstream/.test(m) ||
          c === "429" ||
          c === "503" ||
          c === "502"
        ? "capacity"
        : /tool|function call|schema|invalid.*(?:request|argument|parameter)|json|unsupported/.test(m) ||
            c === "400"
          ? "schema_rejected"
          : /unauthor|forbidden|api key|credit|payment|insufficient/.test(m) || c === "401" || c === "402" || c === "403"
            ? "auth"
            : "unknown";

  return { kind, code, message: message.slice(0, 500) };
}

/** Plain, non-technical line for the user. Never names models or providers. */
export function userFacingProviderMessage(kind: ProviderErrorKind): string {
  switch (kind) {
    case "context_overflow":
      return "That change reached across more of the app than Kimble could hold at once.";
    case "capacity":
      return "Kimble's build service was briefly busy.";
    case "schema_rejected":
      return "Kimble couldn't shape that change safely on the first pass.";
    case "auth":
      return "Kimble couldn't reach its build service.";
    default:
      return "Kimble's build service didn't complete that request.";
  }
}
