import { describe, expect, it } from "vitest";
import {
  buildTerminalResult,
  categoryFromReason,
  containsOptimisticClaim,
  formatTerminalResult,
} from "@/lib/terminal-result";
import { scopeDbQuery } from "@/server/agent-db-scope";
import { writeGateDisclosure } from "@/server/write-gate.server";

const ids = { projectId: "p1", userId: "u1", turnId: "t1" };

describe("authoritative terminal result", () => {
  it("hospital regression: rolled-back turn says nothing landed", () => {
    const r = buildTerminalResult({
      turnId: "729d3e11",
      category: "verification_failed",
      committedRevision: null,
      baseRevision: 1,
      rejections: [{ path: "src/main.tsx", detail: 'src/main.tsx imports "./App", which does not exist.' }],
    });
    const text = formatTerminalResult(r);
    expect(r.projectChanged).toBe(false);
    expect(r.turnId).toBe("729d3e11");
    expect(text).toMatch(/nothing was saved/i);
    expect(text).toMatch(/left exactly as it was/i);
    expect(text).toContain("src/main.tsx");
    expect(containsOptimisticClaim(text)).toBe(false);
  });

  it("detects the old contradictory language", () => {
    expect(containsOptimisticClaim("Everything else landed and your app is still in a working state.")).toBe(true);
    expect(containsOptimisticClaim("ShieldIntake ships with a scan-to-start flow")).toBe(true);
  });

  it("partial-save disclosure no longer claims everything landed", () => {
    const note = writeGateDisclosure([{ path: "src/pages/Bookings.tsx", detail: "parse", reverted: false }]);
    expect(note).not.toMatch(/everything else landed/i);
  });

  it("classifies provider and cancel reasons", () => {
    expect(categoryFromReason("provider 502 upstream")).toBe("infrastructure");
    expect(categoryFromReason("verification_failed")).toBe("verification_failed");
    expect(categoryFromReason("cancelled_by_user")).toBe("cancelled");
    expect(buildTerminalResult({ turnId: "t", outcome: "aborted" }).category).toBe("cancelled");
  });

  it("committed revision before failure is reported as a change", () => {
    const r = buildTerminalResult({ turnId: "t", reason: "verification_failed", baseRevision: 3, committedRevision: 4 });
    expect(r.projectChanged).toBe(true);
    expect(r.preserved).toMatch(/Revision 4/);
  });
});

describe("failed-turn persistence on the background builder", () => {
  it("allows the terminal reply insert, pinned to the turn's project", () => {
    const q = scopeDbQuery(
      { op: "db.query", table: "messages", action: "insert", filters: [], values: { project_id: "other", role: "assistant", content: "x" } },
      ids,
    );
    expect("error" in q).toBe(false);
    expect((q as { values: { project_id: string } }).values.project_id).toBe("p1");
  });
  it("refuses cross-project reads and message deletes", () => {
    expect(scopeDbQuery({ op: "db.query", table: "messages", action: "select", filters: [{ col: "project_id", op: "eq", value: "other" }] }, ids)).toEqual({ error: "scope_violation" });
    expect(scopeDbQuery({ op: "db.query", table: "messages", action: "delete", filters: [] }, ids)).toEqual({ error: "action_not_allowed" });
  });
});
