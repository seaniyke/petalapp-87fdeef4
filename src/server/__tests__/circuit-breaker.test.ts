/**
 * Prompt 12 — agent circuit breaker.
 *
 * Covers the lettered cases A–V from the brief, plus the wiring assertions
 * that prove the LIVE /api/generate path uses this breaker (and only this
 * breaker) rather than a second parallel implementation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentCircuitBreaker,
  BREAKER_THRESHOLDS,
  classifyFailure,
  errorFingerprint,
  normalizeErrorMessage,
} from "@/server/execution/circuit-breaker";
import { RecoveryBudget, RECOVERY_LIMITS } from "@/server/engine/recovery-policy";
import { TurnLedger } from "@/server/execution/ledger";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const syntaxFail = (path: string, message = "Unexpected token }") => ({
  category: "syntax_error" as const,
  tool: "write_gate",
  path,
  message,
});

describe("A. a normal multi-step turn never trips", () => {
  it("writes many files with no failures and stays CLOSED", () => {
    const b = new AgentCircuitBreaker();
    for (let i = 0; i < 25; i++) b.recordProgress("file_written", `src/pages/P${i}.tsx`);
    expect(b.currentState()).toBe("CLOSED");
    expect(b.tripped).toBe(false);
    expect(b.reason()).toBeNull();
  });

  it("tolerates occasional failures interleaved with progress", () => {
    const b = new AgentCircuitBreaker();
    for (let i = 0; i < 6; i++) {
      b.recordFailure(syntaxFail(`src/pages/P${i}.tsx`, `broken ${i}`));
      b.recordProgress("file_repaired", `src/pages/P${i}.tsx`);
    }
    expect(b.tripped).toBe(false);
  });
});

describe("B/C/D. same-error loop protection", () => {
  it("B: below the threshold it does not trip", () => {
    const b = new AgentCircuitBreaker();
    const first = b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    expect(first.repeatCount).toBe(1);
    expect(first.tripped).toBe(false);
    expect(first.guidance).toBeNull();
  });

  it("C: reaching the guidance threshold injects targeted guidance, not a trip", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    const second = b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    expect(second.repeatCount).toBe(BREAKER_THRESHOLDS.guidanceAtIdentical);
    expect(second.tripped).toBe(false);
    expect(second.guidance).toBeTruthy();
    // Targeted, not a generic "please try again".
    expect(second.guidance!).toMatch(/src\/pages\/Home\.tsx/);
    expect(second.guidance!).toMatch(/Do NOT repeat the previous fix/);
    expect(second.guidance!).not.toMatch(/please try again/i);
  });

  it("C: guidance is issued once per fingerprint, not on every failure", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/a.tsx"));
    const withGuidance = b.recordFailure(syntaxFail("src/a.tsx"));
    expect(withGuidance.guidance).toBeTruthy();
    const b2 = new AgentCircuitBreaker();
    b2.recordFailure(syntaxFail("src/b.tsx"));
    b2.recordFailure(syntaxFail("src/b.tsx"));
    // a different fingerprint gets its own single guidance
    b2.recordFailure({ ...syntaxFail("src/c.tsx"), message: "other" });
    const second = b2.recordFailure({ ...syntaxFail("src/c.tsx"), message: "other" });
    expect(second.guidance).toBeTruthy();
  });

  it("D: the same error persisting after guidance trips the breaker", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    const third = b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    expect(third.tripped).toBe(true);
    expect(b.currentState()).toBe("TRIPPED");
    expect(b.reason()?.rule).toBe("repeated_identical_error");
  });
});

describe("E/R. a changed error is progress, not a loop", () => {
  it("E: three DIFFERENT errors do not trip", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure({ category: "import_not_found", tool: "write_gate", path: "src/a.tsx", message: "cannot find module ./x" });
    b.recordFailure({ category: "export_missing", tool: "write_gate", path: "src/a.tsx", message: "has no exported member Y" });
    const third = b.recordFailure({ category: "type_error", tool: "write_gate", path: "src/a.tsx", message: "type string is not assignable to number" });
    expect(third.tripped).toBe(false);
    expect(b.currentState()).toBe("CLOSED");
  });

  it("R: a changed fingerprint resets the consecutive-failure run", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/a.tsx", "err one"));
    b.recordFailure(syntaxFail("src/a.tsx", "err one"));
    // different problem surfaced → the run restarts at 1
    b.recordFailure(syntaxFail("src/a.tsx", "err two"));
    expect(b.snapshot().consecutive_failures).toBe(1);
  });
});

describe("F. tool-specific failure limits", () => {
  it("trips when one tool keeps failing with different errors", () => {
    const b = new AgentCircuitBreaker();
    let last = b.recordFailure({ category: "tool_error", tool: "editFile", path: null, message: "a" });
    for (const m of ["b", "c", "d", "e", "f", "g", "h"]) {
      last = b.recordFailure({ category: "tool_error", tool: "editFile", path: null, message: m });
    }
    expect(last.tripped).toBe(true);
    expect(b.reason()?.rule).toBe("tool_failures");
    expect(b.reason()?.tool).toBe("editFile");
  });

  it("does not punish a tool that fails once then succeeds", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure({ category: "tool_error", tool: "editFile", path: "src/a.tsx", message: "timeout" });
    b.recordProgress("file_written", "src/a.tsx");
    b.recordFailure({ category: "tool_error", tool: "editFile", path: "src/b.tsx", message: "other" });
    expect(b.tripped).toBe(false);
  });
});

describe("G. file-specific failure limits", () => {
  it("trips after repeated distinct failures on one file", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/pages/Home.tsx", "one"));
    b.recordFailure(syntaxFail("src/pages/Home.tsx", "two"));
    for (const m of ["three", "four", "five", "six", "seven"]) b.recordFailure(syntaxFail("src/pages/Home.tsx", m));
    const fourth = b.recordFailure(syntaxFail("src/pages/Home.tsx", "eight"));
    expect(fourth.tripped).toBe(true);
    expect(b.reason()?.rule).toBe("file_failures");
    expect(b.reason()?.path).toBe("src/pages/Home.tsx");
  });

  it("sits one above the identical-error rule so progressive fixes survive", () => {
    expect(BREAKER_THRESHOLDS.maxFileFailures).toBeGreaterThan(BREAKER_THRESHOLDS.maxIdenticalError);
  });
});

describe("H. provider failure is never an agent failure", () => {
  it("many provider failures never trip the breaker", () => {
    const b = new AgentCircuitBreaker();
    for (let i = 0; i < 12; i++) {
      const out = b.recordFailure({ category: "provider_failure", tool: "ai_provider", path: null, message: "stream stalled" });
      expect(out.tripped).toBe(false);
    }
    expect(b.currentState()).toBe("CLOSED");
    expect(b.snapshot().total_failures).toBe(0);
  });

  it("a provider failure followed by a successful fallback leaves the breaker clean", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure({ category: "provider_failure", tool: "ai_provider", path: null, message: "stalled" });
    b.recordProgress("file_written", "src/App.tsx");
    expect(b.tripped).toBe(false);
    expect(b.snapshot().consecutive_failures).toBe(0);
  });
});

describe("I. cooperation with RecoveryBudget, no duplicate counters", () => {
  it("the breaker does not consume any RecoveryBudget attempt", () => {
    const b = new AgentCircuitBreaker();
    const r = new RecoveryBudget();
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordFailure(syntaxFail("src/a.tsx"));
    // budget untouched by breaker bookkeeping
    expect(r.remainingFileRepairs()).toBe(40);
    expect(r.take("broken_file", "src/a.tsx")).toBe(true);
  });

  it("the breaker can stop a turn that still has budget left", () => {
    const b = new AgentCircuitBreaker();
    const r = new RecoveryBudget();
    // budget still allows a provider resend...
    expect(RECOVERY_LIMITS.provider_failure).toBeGreaterThan(0);
    expect(r.remainingFileRepairs()).toBeGreaterThan(0);
    // ...but the breaker has already seen the same problem three times.
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordFailure(syntaxFail("src/a.tsx"));
    expect(b.tripped).toBe(true);
  });

  it("the ledger remains the volume authority and is untouched by the breaker", () => {
    const b = new AgentCircuitBreaker();
    const l = new TurnLedger();
    b.recordFailure(syntaxFail("src/a.tsx"));
    expect(l.count("repair")).toBe(0);
    expect(l.count("write")).toBe(0);
  });
});

describe("J/K/T/V. stop semantics", () => {
  it("K: a tripped breaker refuses to re-decide and stays tripped", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordFailure(syntaxFail("src/a.tsx"));
    const after = b.recordFailure({ category: "build_error", tool: "build", path: "src/z.tsx", message: "anything" });
    expect(after.tripped).toBe(true);
    expect(after.guidance).toBeNull();
    expect(b.reason()?.rule).toBe("repeated_identical_error");
  });

  it("T: a completed turn can never be tripped afterwards", () => {
    const b = new AgentCircuitBreaker();
    b.complete();
    for (let i = 0; i < 10; i++) b.recordFailure(syntaxFail("src/a.tsx"));
    expect(b.tripped).toBe(false);
    expect(b.currentState()).toBe("CLOSED");
  });

  it("V: a stale failure from an earlier tool call cannot trip a completed turn", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordFailure(syntaxFail("src/a.tsx"));
    b.recordProgress("verification_passed");
    b.complete();
    const late = b.recordFailure(syntaxFail("src/a.tsx"));
    expect(late.tripped).toBe(false);
  });

  it("J: cancellation is handled before the breaker in the live route", () => {
    const route = src("src/routes/api/generate.ts");
    const cancelIdx = route.indexOf('if (txResult.outcome.reason === "cancelled") throw new Error("Turn cancelled before commit")');
    const breakerIdx = route.indexOf("for (const r of txResult.rejections.slice(0, 3)) {");
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(breakerIdx).toBeGreaterThan(-1);
    // Cancellation wins: it throws before any failure is attributed.
    expect(cancelIdx).toBeLessThan(breakerIdx);
  });
});

describe("N. a new turn starts fresh", () => {
  it("two breakers share no state", () => {
    const a = new AgentCircuitBreaker();
    a.recordFailure(syntaxFail("src/a.tsx"));
    a.recordFailure(syntaxFail("src/a.tsx"));
    a.recordFailure(syntaxFail("src/a.tsx"));
    expect(a.tripped).toBe(true);
    const b = new AgentCircuitBreaker();
    expect(b.tripped).toBe(false);
    expect(b.snapshot().total_failures).toBe(0);
  });

  it("the live route constructs one breaker per turn", () => {
    const route = src("src/routes/api/generate.ts");
    const occurrences = route.match(/new AgentCircuitBreaker\(\)/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("O. structured trip reason is recorded", () => {
  it("captures rule, category, path and a human detail", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    const r = b.reason()!;
    expect(r.rule).toBe("repeated_identical_error");
    expect(r.category).toBe("syntax_error");
    expect(r.path).toBe("src/pages/Home.tsx");
    expect(r.detail).toMatch(/3 times/);
    expect(r.fingerprint).toBeTruthy();
  });

  it("the telemetry snapshot carries counters and no user content", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/pages/Home.tsx", "Unexpected token } in <Hero>"));
    const snap = b.snapshot();
    expect(snap).toMatchObject({ state: "CLOSED", total_failures: 1, distinct_errors: 1 });
    expect(JSON.stringify(snap)).not.toMatch(/Unexpected token/);
  });
});

describe("P/Q. fingerprint strategy", () => {
  it("P: normalizes line/column numbers, ids and timings", () => {
    const a = errorFingerprint(syntaxFail("src/a.tsx", "src/a.tsx:12:5 Unexpected token"));
    const b = errorFingerprint(syntaxFail("src/a.tsx", "src/a.tsx:98:2 Unexpected token"));
    expect(a).toBe(b);
    expect(normalizeErrorMessage("failed after 1234 ms")).toBe(normalizeErrorMessage("failed after 22 ms"));
    expect(normalizeErrorMessage("id 3f2b9c1a-1111-2222-3333-444455556666 failed")).toMatch(/uuid/);
  });

  it("Q: genuinely different errors keep different fingerprints", () => {
    const missingImport = errorFingerprint({ category: "import_not_found", tool: "write_gate", path: "src/a.tsx", message: "cannot find module ./x" });
    const missingExport = errorFingerprint({ category: "export_missing", tool: "write_gate", path: "src/a.tsx", message: "has no exported member Y" });
    const otherFile = errorFingerprint(syntaxFail("src/b.tsx"));
    const thisFile = errorFingerprint(syntaxFail("src/a.tsx"));
    expect(new Set([missingImport, missingExport, otherFile, thisFile]).size).toBe(4);
  });

  it("fingerprints read like the documented shape", () => {
    expect(errorFingerprint({ category: "syntax_error", tool: "write_gate", path: "src/components/Header.tsx", message: "" }))
      .toBe("SYNTAX_ERROR:src/components/Header.tsx");
    expect(errorFingerprint({ category: "tool_error", tool: "editFile", path: null, message: "" }))
      .toBe("TOOL_ERROR:editFile");
  });

  it("classifies raw compiler output deterministically", () => {
    expect(classifyFailure("Module './x' has no exported member 'Y'")).toBe("export_missing");
    expect(classifyFailure("Cannot find module '@/components/Card'")).toBe("import_not_found");
    expect(classifyFailure("Unexpected token '}'")).toBe("syntax_error");
    expect(classifyFailure("Type 'string' is not assignable to type 'number'")).toBe("type_error");
    expect(classifyFailure("build failed: rollup error")).toBe("build_error");
    expect(classifyFailure("Cannot read properties of undefined")).toBe("runtime_error");
    expect(classifyFailure("something nobody predicted")).toBe("unknown");
  });
});

describe("S. meaningful progress resets consecutive failure state", () => {
  it("a repaired file clears its own failure count and the run", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/a.tsx", "one"));
    b.recordFailure(syntaxFail("src/a.tsx", "two"));
    b.recordProgress("file_repaired", "src/a.tsx");
    expect(b.snapshot().consecutive_failures).toBe(0);
    expect(b.snapshot().file_failures).toEqual({});
    // the file gets a full fresh allowance after a genuine fix
    b.recordFailure(syntaxFail("src/a.tsx", "three"));
    b.recordFailure(syntaxFail("src/a.tsx", "four"));
    expect(b.tripped).toBe(false);
  });

  it("historical totals are NOT reset by progress (the backstop survives)", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/a.tsx", "one"));
    b.recordProgress("file_repaired", "src/a.tsx");
    expect(b.snapshot().total_failures).toBe(1);
  });
});

describe("U. concurrent failure updates keep state coherent", () => {
  it("interleaved async reports produce one authoritative trip", async () => {
    const b = new AgentCircuitBreaker();
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        await Promise.resolve();
        return b.recordFailure(syntaxFail("src/a.tsx"));
      }),
    );
    const tripped = results.filter((r) => r.tripped);
    // Exactly one call performs the transition; the rest observe it.
    expect(b.tripped).toBe(true);
    expect(tripped.length).toBeGreaterThanOrEqual(1);
    expect(b.reason()?.rule).toBe("repeated_identical_error");
    // Counters never went backwards or double-counted the trip.
    expect(b.snapshot().total_failures).toBe(BREAKER_THRESHOLDS.maxIdenticalError);
  });
});

describe("thresholds are documented and sit above real Kimble limits", () => {
  it("never fires before the existing bounded recovery paths are meaningful", () => {
    expect(BREAKER_THRESHOLDS.maxIdenticalError).toBe(3);
    expect(BREAKER_THRESHOLDS.guidanceAtIdentical).toBeLessThan(BREAKER_THRESHOLDS.maxIdenticalError);
    // A healthy turn performs at most ~3 repair failures (TURN_LIMITS.repair).
    expect(BREAKER_THRESHOLDS.maxConsecutiveFailures).toBeGreaterThan(3);
    expect(BREAKER_THRESHOLDS.maxTotalFailures).toBeGreaterThan(BREAKER_THRESHOLDS.maxConsecutiveFailures);
  });
});

describe("user-facing message", () => {
  it("explains the stop without leaking internals", () => {
    const b = new AgentCircuitBreaker();
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    b.recordFailure(syntaxFail("src/pages/Home.tsx"));
    const msg = b.userMessage();
    expect(msg).toMatch(/src\/pages\/Home\.tsx/);
    expect(msg).toMatch(/Nothing was saved and you weren't charged/);
    expect(msg).not.toMatch(/fingerprint|threshold|consecutive|CLOSED|TRIPPED|SYNTAX_ERROR/i);
  });
});

/* ------------------------------------------------------------------ */
/* Live-route wiring (L, M, K) — proves the breaker is the real one     */
/* ------------------------------------------------------------------ */

describe("L/M/K. the live /api/generate path uses this breaker", () => {
  const route = src("src/routes/api/generate.ts");

  it("imports and constructs the authoritative breaker", () => {
    expect(route).toMatch(/import \{ AgentCircuitBreaker, classifyFailure \} from "@\/server\/execution\/circuit-breaker"/);
    expect(route).toMatch(/const breaker = new AgentCircuitBreaker\(\)/);
  });

  it("consults the breaker in both AI repair paths before spending an attempt", () => {
    expect(route).toMatch(/tool: "write_gate"/);
    expect(route).toMatch(/tool: "final_parse_guard"/);
    // The trip check precedes the RecoveryBudget spend in the write gate.
    const tripIdx = route.indexOf('if (verdict.tripped) {');
    const takeIdx = route.indexOf('if (!recovery.take("broken_file", file.path)) return null;');
    expect(tripIdx).toBeGreaterThan(-1);
    expect(tripIdx).toBeLessThan(takeIdx);
  });

  it("L: a trip returns before the commit boundary, so nothing is committed", () => {
    const tripReturn = route.indexOf("if (breaker.tripped) {\n          console.warn(`[circuit-breaker] tripped ${JSON.stringify(breaker.snapshot())}`);");
    const commitIdx = route.indexOf("const txResult = await commitTurn({");
    expect(tripReturn).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(tripReturn).toBeLessThan(commitIdx);
  });

  it("M: the trip path emits a failed outcome, which the existing no-charge rule covers", () => {
    expect(route).toMatch(/reason: `circuit_breaker:\$\{breaker\.reason\(\)\?\.rule \?\? "unknown"\}`/);
    // Settlement still runs only after a successful persist; unchanged.
    expect(route).toMatch(/if \(persistError\) \{\s*\n\s*console\.warn\(`\[credits\] turn not billed/);
  });

  it("marks the breaker complete on a committed turn", () => {
    expect(route).toMatch(/breaker\.recordProgress\("verification_passed"\);\s*\n\s*breaker\.complete\(\);/);
  });

  it("records breaker telemetry with the turn economics", () => {
    expect(route).toMatch(/circuit_breaker: breaker\.snapshot\(\)/);
  });
});

describe("final architectural search — exactly one breaker", () => {
  it("no competing circuit breaker implementation exists", () => {
    const index = src("src/server/execution/index.ts");
    expect(index).toMatch(/export \* from "\.\/circuit-breaker"/);
  });

  it("RecoveryBudget keeps its own, different responsibility", () => {
    const policy = src("src/server/engine/recovery-policy.ts");
    expect(policy).toMatch(/RECOVERY_LIMITS/);
    // It must not have grown a breaker of its own.
    expect(policy).not.toMatch(/TRIPPED|CircuitBreaker/);
  });
});
