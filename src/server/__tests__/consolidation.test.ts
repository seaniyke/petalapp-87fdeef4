import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { applyContextBudget, budgetMessages, estimateMessagesTokens, type BudgetMessage } from "@/server/context/budget";
import { classifyRequest } from "@/server/execution/classify";
import { finalizeVerification, runSourceGates, buildGate, browserGate, routesGate } from "@/server/verification/gates";
import { TurnLedger, commitTurn } from "@/server/execution";
import { classifyBuildFailure, isInfrastructureBuildError } from "@/lib/friendly-errors";

const gen = readFileSync("src/routes/api/generate.ts", "utf8");

describe("context: one budget module", () => {
  it("the legacy budget module is gone and generate uses only context/budget", () => {
    expect(existsSync("src/server/context-budget.server.ts")).toBe(false);
    expect(gen).not.toMatch(/context-budget\.server/);
    expect(gen.match(/budgetMessages\(/g)?.length).toBe(1);
  });

  it("drops lower-priority sections, never required ones", () => {
    const r = applyContextBudget(
      [
        { id: "system", priority: "required", text: "x".repeat(400) },
        { id: "skills", priority: "skills", text: "y".repeat(4000) },
      ],
      200,
    );
    expect(r.dropped).toEqual(["skills"]);
  });

  it("fits history under the budget without touching the pinned system prompt", () => {
    const sys: BudgetMessage = { role: "system", content: "S".repeat(2000) };
    const msgs: BudgetMessage[] = [sys, ...Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user", content: "h".repeat(2000) })), { role: "user", content: "now do X" }];
    const r = budgetMessages(msgs, 3000);
    expect(r.messages[0]).toBe(sys);
    expect((r.messages[0]!.content as string).length).toBe(2000);
    expect(r.messages.at(-1)!.content).toBe("now do X");
    expect(r.droppedCount).toBeGreaterThan(0);
    expect(estimateMessagesTokens(r.messages)).toBeLessThanOrEqual(3000);
  });

  it("keeps constraint carriers over recent chatter", () => {
    const msgs: BudgetMessage[] = [
      { role: "system", content: "S" },
      { role: "user", content: "never use purple" },
      ...Array.from({ length: 10 }, () => ({ role: "assistant" as const, content: "z".repeat(800) })),
      { role: "user", content: "go" },
    ];
    const r = budgetMessages(msgs, 700);
    expect(r.messages.some((m) => m.content === "never use purple")).toBe(true);
  });
});

describe("verification: completeness cannot override", () => {
  const files = [
    { path: "package.json", content: "{}" },
    { path: "src/App.tsx", content: "export default function App(){return <div/>}" },
  ];
  it("the app-shell requirement is a routes-gate FAIL (one decision)", () => {
    expect(routesGate(files, ["/"], { requireShell: true }).verdict).toBe("FAIL");
  });
  it("FAILED/UNVERIFIED source never commits regardless of completeness", async () => {
    for (const status of ["FAILED", "UNVERIFIED"] as const) {
      const r = await commitTurn({
        baseline: [{ path: "a.ts", content: "1" }],
        proposed: [{ path: "a.ts", content: "2" }],
        ledger: new TurnLedger(),
        isSystemPath: () => false,
        protectionReason: () => null,
        checks: [],
        cancelled: () => false,
        verifySource: async () => ({ status, gates: [], failedGate: status === "FAILED" ? "routes" : null, reason: "x", repairTargets: [] }),
      });
      expect(r.outcome.status).toBe("rolled_back");
    }
  });
  it("failed build / runtime are never READY", () => {
    const src = runSourceGates({ files: [{ path: "package.json", content: "{}" }], requestedRoutes: [], esbuild: { status: "passed" } });
    expect(finalizeVerification([...src, buildGate("failed")]).status).toBe("FAILED");
    expect(finalizeVerification([...src, buildGate("succeeded"), browserGate({ verdict: "not_ready", reasons: ["x"] })]).status).toBe("FAILED");
  });
  it("the post-commit completeness block is diagnostic only in generate", () => {
    expect(gen).toMatch(/const verdict = txCommitted\s*\? \{ complete: true/);
    expect(gen).toMatch(/emitTurnOutcome\(controller, encoder, txBlocked/);
  });
});

describe("writes: one generation write boundary", () => {
  it("generate has one replaceFiles call, guarded by txCommitted", () => {
    expect(gen.match(/replaceFiles\(/g)?.length).toBe(1);
    expect(gen).toMatch(/if \(!\(body\.projectId && txCommitted && nextFiles\.length > 0\)\) return;/);
  });
  it("the browser no longer re-saves generated files after a turn", () => {
    const b = readFileSync("src/routes/builder.tsx", "utf8");
    expect(b).not.toMatch(/saveProjectFiles\(proj\.id, files2\)/);
  });
});

describe("intent: one classifier", () => {
  const c = (r: string, isInitial = false) => classifyRequest(r, { isInitial });
  it("the AI edit classifier is gone", () => {
    expect(existsSync("src/server/edit-classifier.server.ts")).toBe(false);
    expect(gen).not.toMatch(/classifyEdit\(/);
    expect(gen.match(/classifyRequest\(/g)?.length).toBe(1);
  });
  it("representative requests, deterministic and self-consistent", () => {
    expect(c("build a bakery website", true).operation).toBe("first_build");
    expect(c("change the headline on the home page to 'Fresh daily'").operation).toBe("content_change");
    expect(c("make the buttons rounded and bigger").operation).toBe("styling_change");
    expect(c("add a pricing page").operation).toBe("page_creation");
    expect(c("add a new page for pricing").operation).toBe("page_creation"); // adding a page is page creation, not site-wide
    expect(c("fix the build error").operation).toBe("repair");
    expect(c("fix the typo in the footer").edit?.scope).toBe("micro");
    const a = c("redesign the whole site");
    expect(a.operation).toBe("architectural_change");
    expect(a.crossCutting).toBe(true);
    expect(a.edit?.scope).toBe("structural");
    expect(c("make the buttons rounded")).toEqual(c("make the buttons rounded"));
  });
});

describe("build failures: one classifier", () => {
  it("classifies consistently", () => {
    expect(classifyBuildFailure("src/App.tsx(3,1): error TS2304: Cannot find name 'x'").kind).toBe("code");
    const dep = classifyBuildFailure('[vite]: Rollup failed to resolve import "framer-motion" from "src/App.tsx"');
    expect(dep).toMatchObject({ kind: "missing_dependency", packages: ["framer-motion"], autoFix: false, retryable: false });
    expect(classifyBuildFailure("could not reach build service: fetch failed").kind).toBe("infrastructure");
    expect(classifyBuildFailure("The operation was aborted due to timeout").kind).toBe("timeout");
    expect(classifyBuildFailure("builder unreachable 503 upstream").kind).toBe("infrastructure");
    expect(classifyBuildFailure("something odd happened").kind).toBe("unknown");
  });
  it("infra/timeout are retryable and never auto-fixed; code is auto-fixed and not retried", () => {
    for (const log of ["cloudflare error code: 1016", "The operation was aborted"]) {
      expect(isInfrastructureBuildError(log)).toBe(true);
      expect(classifyBuildFailure(log).autoFix).toBe(false);
    }
    const code = classifyBuildFailure("Transform failed with 1 error: Unexpected token");
    expect(code.autoFix).toBe(true);
    expect(isInfrastructureBuildError("Transform failed with 1 error: Unexpected token")).toBe(false);
  });
});
