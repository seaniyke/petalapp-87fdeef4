/**
 * THE agent-level circuit breaker (Prompt 12).
 *
 * Responsibility boundary — there is exactly ONE of each of these, and they
 * do NOT duplicate one another:
 *
 *   TurnLedger          → how MANY operations a turn may perform (volume).
 *   RecoveryBudget      → how many attempts a SPECIFIC recovery mechanism
 *                         (provider resend, broken-file repair, build fix)
 *                         is allowed (quota).
 *   AgentCircuitBreaker → whether the agent is still making USEFUL PROGRESS
 *                         at all (health). It can stop a turn that still has
 *                         budget and ledger headroom left, because spending
 *                         them would repeat a failure that already happened.
 *
 * The breaker never persists files, never charges, never bypasses the
 * transaction: it only decides "keep going" vs "stop". The existing
 * TurnTransaction + source verification remain authoritative for what may
 * actually land.
 *
 * Deterministic and cheap by construction: no AI call, no IO, no async.
 */

/* ------------------------------------------------------------------ */
/* Failure categories                                                  */
/* ------------------------------------------------------------------ */

/**
 * What kind of thing went wrong. Deliberately coarse: the fingerprint adds
 * the specificity, the category selects the recovery guidance.
 *
 * `provider_failure` is tracked for telemetry only and NEVER counts toward a
 * trip — gateway provider failover already owns that problem, and a model
 * that stalls is not an agent that is reasoning badly.
 */
export type FailureCategory =
  | "syntax_error"
  | "import_not_found"
  | "export_missing"
  | "type_error"
  | "build_error"
  | "runtime_error"
  | "tool_error"
  | "scope_violation"
  | "verification_failed"
  | "provider_failure"
  | "unknown";

/** Progress signals. Any of these means the turn moved forward. */
export type ProgressKind =
  | "file_written"
  | "file_repaired"
  | "file_deleted"
  | "verification_passed"
  | "error_changed";

export type BreakerState = "CLOSED" | "TRIPPED";

export interface FailureInput {
  category: FailureCategory;
  /** Tool/stage that produced the failure, e.g. "write_gate", "repair". */
  tool?: string | null;
  /** File the failure clearly belongs to, when there is one. */
  path?: string | null;
  /** Raw error text. Normalised into the fingerprint; never stored verbatim. */
  message?: string | null;
}

export interface TripReason {
  rule:
    | "repeated_identical_error"
    | "consecutive_failures"
    | "tool_failures"
    | "file_failures"
    | "total_failures";
  fingerprint: string | null;
  category: FailureCategory;
  tool: string | null;
  path: string | null;
  detail: string;
}

export interface FailureOutcome {
  state: BreakerState;
  tripped: boolean;
  /** Targeted guidance to inject into the next attempt (null = none needed). */
  guidance: string | null;
  fingerprint: string;
  /** How many times this exact fingerprint has been seen this turn. */
  repeatCount: number;
  reason: TripReason | null;
}

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

/**
 * Chosen against Kimble's REAL existing limits so the breaker stops
 * pathological loops without ever interrupting a legitimate build:
 *
 *  - TURN_LIMITS.repair is 3 and RECOVERY_LIMITS.broken_file is 1 per file
 *    (max 3 files), so a healthy turn performs at most ~3 repair failures.
 *    `maxConsecutiveFailures: 5` therefore sits comfortably above anything a
 *    productive turn does, while still catching a runaway.
 *  - `maxIdenticalError: 3` means: fail, retry, fail again → guidance is
 *    injected at 2; a third identical failure is proof the guidance did not
 *    help, so it trips. Two identical failures are common and normal.
 *  - `maxToolFailures: 4` — a tool that failed four times this turn with no
 *    success in between is broken, not unlucky.
 *  - `maxFileFailures: 4` — deliberately ONE above the identical-error rule.
 *    Three DIFFERENT errors on one file is a file being progressively fixed
 *    (import → export → type), which must not trip; a fourth says the file
 *    itself is the problem and needs a different strategy, not another
 *    rewrite. A genuine fix resets the file's count entirely.
 *  - `maxTotalFailures: 10` — a hard backstop well above TURN_LIMITS.repair
 *    plus every bounded recovery path combined.
 */
export interface BreakerThresholds {
  maxIdenticalError: number;
  maxConsecutiveFailures: number;
  maxToolFailures: number;
  maxFileFailures: number;
  maxTotalFailures: number;
  /** Identical-error count at which guidance is injected (before tripping). */
  guidanceAtIdentical: number;
}

export const BREAKER_THRESHOLDS: Readonly<BreakerThresholds> = {
  maxIdenticalError: 3,
  maxConsecutiveFailures: 8,
  maxToolFailures: 8,
  maxFileFailures: 8,
  maxTotalFailures: 40,
  guidanceAtIdentical: 2,
};

/* ------------------------------------------------------------------ */
/* Fingerprinting                                                      */
/* ------------------------------------------------------------------ */

/**
 * Strip values that legitimately differ between two occurrences of the SAME
 * problem (line/column numbers, byte offsets, timings, quoted identifiers are
 * kept because they identify the problem).
 *
 * Deliberately conservative: over-normalising would collapse unrelated
 * errors into one fingerprint and trip the breaker on healthy progress.
 */
export function normalizeErrorMessage(message: string): string {
  return (
    message
      .toLowerCase()
      // file:line:col → file
      .replace(/:\d+:\d+/g, "")
      .replace(/\bline \d+/g, "line")
      .replace(/\bcolumn \d+/g, "column")
      // timings / sizes / ids that change per attempt
      .replace(/\b\d+\s?ms\b/g, "ms")
      .replace(/\b0x[0-9a-f]+\b/g, "hex")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "uuid")
      .replace(/\b\d{3,}\b/g, "n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160)
  );
}

/** Deterministic fingerprint: category, tool, path and normalised message. */
export function errorFingerprint(input: FailureInput): string {
  const category = input.category.toUpperCase();
  const scope = input.path?.trim() || input.tool?.trim() || "-";
  const detail = normalizeErrorMessage(input.message ?? "");
  return detail ? `${category}:${scope}:${detail}` : `${category}:${scope}`;
}

/* ------------------------------------------------------------------ */
/* Recovery guidance                                                   */
/* ------------------------------------------------------------------ */

const GUIDANCE: Record<FailureCategory, string> = {
  syntax_error:
    "Re-read the whole file before editing it. Find the unbalanced bracket, tag or quote and make the smallest correction that closes it. Do not rewrite the file from scratch.",
  import_not_found:
    "Check the real file list before importing. Verify the path and the exact capitalisation. If the file genuinely does not exist, either create it or remove the import — do not guess a new path.",
  export_missing:
    "Open the module you are importing from and read its actual exports. Import a name that exists, or add the missing export to that module. Do not invent an export name.",
  type_error:
    "Read the reported type against the value you are passing. Fix the source of the mismatch rather than casting it away.",
  build_error:
    "Read the exact compiler output and fix the underlying source. Do not re-run the same build without changing code.",
  runtime_error:
    "Identify the route and component in the error, then fix that component. Do not rebuild unchanged code.",
  tool_error:
    "Check the arguments you passed. If the same call keeps failing, use a different approach instead of repeating it.",
  scope_violation:
    "Change only the files this request is about. Do not edit shared layout or unrelated pages.",
  verification_failed:
    "The change did not pass the safety check. Fix the exact file and reason named, then stop — do not widen the change.",
  provider_failure:
    "The AI service dropped the response. Send the same request again; do not change the plan.",
  unknown:
    "Re-read the affected file, reconsider the approach and try a different strategy from the one that just failed.",
};

/* ------------------------------------------------------------------ */
/* The breaker                                                         */
/* ------------------------------------------------------------------ */

export class AgentCircuitBreaker {
  private state: BreakerState = "CLOSED";
  private tripReason: TripReason | null = null;

  private totalFailures = 0;
  private consecutiveFailures = 0;
  private readonly byFingerprint = new Map<string, number>();
  private readonly byTool = new Map<string, number>();
  private readonly byFile = new Map<string, number>();
  private lastFingerprint: string | null = null;
  private lastProgressAt: number | null = null;
  private guidanceIssued = new Set<string>();
  /** Set once the turn has produced its committed result. */
  private completed = false;

  constructor(private readonly thresholds: BreakerThresholds = BREAKER_THRESHOLDS) {}

  /* ------------------------------ state ------------------------------ */

  /** True while the agent may keep working. */
  get closed(): boolean {
    return this.state === "CLOSED";
  }

  get tripped(): boolean {
    return this.state === "TRIPPED";
  }

  currentState(): BreakerState {
    return this.state;
  }

  reason(): TripReason | null {
    return this.tripReason;
  }

  /**
   * Mark the turn as finished successfully. After this, a late failure
   * arriving from an earlier tool call can never trip the breaker — a
   * completed turn is not retroactively a failure.
   */
  complete(): void {
    this.completed = true;
  }

  /* ---------------------------- progress ----------------------------- */

  /**
   * The agent moved forward. Resets the consecutive-failure counter and, for
   * a file-scoped success, that file's failure count. Historical totals are
   * intentionally NOT reset: they are the backstop.
   */
  recordProgress(kind: ProgressKind, path?: string | null): void {
    if (this.completed) return;
    this.consecutiveFailures = 0;
    this.lastProgressAt = Date.now();
    this.lastFingerprint = null;
    if (path) this.byFile.delete(path);
    // A tool that just succeeded is working; its earlier failures were
    // transient, so they must not accumulate across a productive turn.
    this.byTool.clear();
    void kind;
  }

  /* ---------------------------- failure ------------------------------ */

  /**
   * Record one agent failure and decide what happens next.
   *
   * Provider failures are recorded for telemetry but can never trip: the
   * provider layer owns them, and a successful failover is not an agent
   * failure at all.
   */
  recordFailure(input: FailureInput): FailureOutcome {
    const fingerprint = errorFingerprint(input);
    const tool = input.tool?.trim() || null;
    const path = input.path?.trim() || null;

    // A completed turn, or an already-tripped breaker, never re-decides.
    if (this.completed || this.state === "TRIPPED") {
      return {
        state: this.state,
        tripped: this.state === "TRIPPED",
        guidance: null,
        fingerprint,
        repeatCount: this.byFingerprint.get(fingerprint) ?? 0,
        reason: this.tripReason,
      };
    }

    const repeatCount = (this.byFingerprint.get(fingerprint) ?? 0) + 1;
    this.byFingerprint.set(fingerprint, repeatCount);

    // Provider trouble: counted for observability, never for health.
    if (input.category === "provider_failure") {
      this.lastFingerprint = fingerprint;
      return {
        state: this.state,
        tripped: false,
        guidance: null,
        fingerprint,
        repeatCount,
        reason: null,
      };
    }

    this.totalFailures++;
    // A DIFFERENT error after a failure is progress: the previous problem was
    // actually fixed and a new one surfaced. Only an identical error extends
    // the consecutive run.
    if (this.lastFingerprint && this.lastFingerprint !== fingerprint) {
      this.consecutiveFailures = 1;
      this.lastProgressAt = Date.now();
    } else {
      this.consecutiveFailures++;
    }
    this.lastFingerprint = fingerprint;

    // Exactly ONE counter owns each failure, so no failure is punished twice.
    // A failure that names a file belongs to that file: "write_gate" is a
    // stage every repair flows through, not a flaky tool, and counting its
    // file failures again under the tool rule would trip healthy turns that
    // are fixing several files. Only file-less failures (a tool that is
    // itself misbehaving) count toward the tool rule.
    if (path) this.byFile.set(path, (this.byFile.get(path) ?? 0) + 1);
    else if (tool) this.byTool.set(tool, (this.byTool.get(tool) ?? 0) + 1);

    const trip = (rule: TripReason["rule"], detail: string): FailureOutcome => {
      this.state = "TRIPPED";
      this.tripReason = { rule, fingerprint, category: input.category, tool, path, detail };
      return {
        state: this.state,
        tripped: true,
        guidance: null,
        fingerprint,
        repeatCount,
        reason: this.tripReason,
      };
    };

    if (repeatCount >= this.thresholds.maxIdenticalError) {
      return trip("repeated_identical_error", `the same problem occurred ${repeatCount} times`);
    }
    if (path && (this.byFile.get(path) ?? 0) >= this.thresholds.maxFileFailures) {
      return trip("file_failures", `${path} failed ${this.byFile.get(path)} times`);
    }
    if (tool && (this.byTool.get(tool) ?? 0) >= this.thresholds.maxToolFailures) {
      return trip("tool_failures", `${tool} failed ${this.byTool.get(tool)} times`);
    }
    if (this.consecutiveFailures >= this.thresholds.maxConsecutiveFailures) {
      return trip("consecutive_failures", `${this.consecutiveFailures} failures with no progress`);
    }
    if (this.totalFailures >= this.thresholds.maxTotalFailures) {
      return trip("total_failures", `${this.totalFailures} failures in one request`);
    }

    // Below every trip threshold — offer targeted guidance once per
    // fingerprint, at the point repetition starts to look deliberate.
    let guidance: string | null = null;
    if (repeatCount >= this.thresholds.guidanceAtIdentical && !this.guidanceIssued.has(fingerprint)) {
      this.guidanceIssued.add(fingerprint);
      guidance = this.buildGuidance(input, repeatCount);
    }

    return { state: this.state, tripped: false, guidance, fingerprint, repeatCount, reason: null };
  }

  /** Compact, targeted guidance. Never the transcript, never a generic retry. */
  private buildGuidance(input: FailureInput, repeatCount: number): string {
    const where = input.path ? ` in ${input.path}` : input.tool ? ` using ${input.tool}` : "";
    const lines = [
      `This exact problem${where} has now happened ${repeatCount} times: ${normalizeErrorMessage(input.message ?? "no detail")}.`,
      `Do NOT repeat the previous fix — it did not work.`,
      GUIDANCE[input.category] ?? GUIDANCE.unknown,
    ];
    if (input.path) {
      lines.push(`Re-read ${input.path} in full and check what actually imports and uses it before editing again.`);
    }
    return lines.join(" ");
  }

  /* --------------------------- user message --------------------------- */

  /**
   * Plain-language explanation for the person. Never exposes counters,
   * fingerprints, thresholds or prompts.
   */
  userMessage(): string {
    const r = this.tripReason;
    if (!r) return "I stopped this change because I couldn't make reliable progress. Your app was left exactly as it was.";
    const where = r.path ? ` in ${r.path}` : "";
    const what =
      r.category === "syntax_error"
        ? "a code error I couldn't clear"
        : r.category === "import_not_found" || r.category === "export_missing"
          ? "a missing piece the code was trying to use"
          : r.category === "build_error"
            ? "a build problem I couldn't clear"
            : r.category === "scope_violation"
              ? "a change that reached outside what you asked for"
              : "the same problem";
    return (
      `I stopped this change because I kept hitting ${what}${where} and wasn't getting any closer to fixing it. ` +
      `Nothing was saved and you weren't charged — your app is exactly as it was. ` +
      `Try asking for a smaller version of the change, or tell me more about what it should do and I'll take a different route.`
    );
  }

  /* ---------------------------- telemetry ----------------------------- */

  /** Structured snapshot for logs. No user content, no prompts, no secrets. */
  snapshot() {
    return {
      state: this.state,
      trip_rule: this.tripReason?.rule ?? null,
      trip_category: this.tripReason?.category ?? null,
      trip_path: this.tripReason?.path ?? null,
      total_failures: this.totalFailures,
      consecutive_failures: this.consecutiveFailures,
      distinct_errors: this.byFingerprint.size,
      max_repeat: Math.max(0, ...this.byFingerprint.values()),
      tool_failures: Object.fromEntries(this.byTool),
      file_failures: Object.fromEntries(this.byFile),
      guidance_issued: this.guidanceIssued.size,
      had_progress: this.lastProgressAt !== null,
      completed: this.completed,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Classification helper                                               */
/* ------------------------------------------------------------------ */

/** Map a raw error string onto a failure category. Deterministic, no AI. */
export function classifyFailure(message: string): FailureCategory {
  const m = message.toLowerCase();
  if (/has no exported member|is not exported|does not provide an export/.test(m)) return "export_missing";
  if (/cannot find module|could not resolve|module not found|does not exist/.test(m)) return "import_not_found";
  if (/unexpected token|unterminated|expected .* but found|syntax error|unbalanced/.test(m)) return "syntax_error";
  if (/type .* is not assignable|ts\d{4}|type error/.test(m)) return "type_error";
  if (/build failed|compilation failed|vite build|rollup/.test(m)) return "build_error";
  if (/is not defined|cannot read propert|undefined is not|render error/.test(m)) return "runtime_error";
  if (/timeout|tool .* failed|invalid arguments/.test(m)) return "tool_error";
  return "unknown";
}
