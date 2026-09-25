import { describe, expect, it } from "vitest";
import { TurnLedger, commitTurn, type Verdict } from "@/server/execution";

const base = [
  { path: "src/pages/Home.tsx", content: "home v1" },
  { path: "src/components/Header.tsx", content: "header v1" },
  { path: "src/routes.ts", content: "routes v1" },
  { path: "package.json", content: "{}" },
];
const none = () => null;
const noSys = () => false;
const run = (proposed: typeof base, o: Partial<Parameters<typeof commitTurn>[0]> = {}) =>
  commitTurn({
    baseline: base,
    proposed,
    ledger: o.ledger ?? new TurnLedger(),
    isSystemPath: o.isSystemPath ?? noSys,
    protectionReason: o.protectionReason ?? none,
    checks: o.checks ?? [],
    cancelled: o.cancelled ?? (() => false),
  });
const edit = (m: Record<string, string>) => base.map((f) => (m[f.path] ? { ...f, content: m[f.path] } : f));

describe("live commit boundary", () => {
  it("A/G: commits a multi-file turn as one state and records it in the ledger", () => {
    const ledger = new TurnLedger();
    const r = run(edit({ "src/pages/Home.tsx": "home v2", "src/components/Header.tsx": "h2", "src/routes.ts": "r2", "package.json": '{"a":1}' }), { ledger, checks: [{ check: "write_gate", verdict: "PASS" }] });
    expect(r.outcome.status).toBe("committed");
    if (r.outcome.status !== "committed") return;
    expect(r.outcome.changed.sort()).toEqual(base.map((f) => f.path).sort());
    expect(ledger.count("write")).toBe(4);
    expect(ledger.committed).toBe(true);
  });

  it("B: a blocking validation failure commits nothing", () => {
    const checks: Array<{ check: string; verdict: Verdict }> = [{ check: "syntax", verdict: "FAIL" }];
    const r = run(edit({ "src/pages/Home.tsx": "home v2", "src/routes.ts": "broken" }), { checks });
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.outcome.files).toEqual(base);
    expect(r.rejections[0]).toMatchObject({ operation: "commit", reason: "validation_failed" });
  });

  it("warnings do not block commit", () => {
    const r = run(edit({ "src/pages/Home.tsx": "home v2" }), { checks: [{ check: "write_gate", verdict: "WARNING" }] });
    expect(r.outcome.status).toBe("committed");
  });

  it("C: exceeding the write limit is refused and nothing lands", () => {
    const ledger = new TurnLedger({ ai_call: 1, read: 1, write: 1, delete: 1, dependency: 1, repair: 1, build: 1, browser: 1 });
    const r = run(edit({ "src/pages/Home.tsx": "x", "src/routes.ts": "y" }), { ledger });
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.rejections.some((x) => x.reason === "limit")).toBe(true);
  });

  it("system-managed files are staged without consuming the write budget", () => {
    const ledger = new TurnLedger({ ai_call: 1, read: 1, write: 1, delete: 1, dependency: 1, repair: 1, build: 1, browser: 1 });
    const kit = Array.from({ length: 20 }, (_, i) => ({ path: `src/components/ui/k${i}.tsx`, content: "k" }));
    const r = run([...edit({ "src/pages/Home.tsx": "v2" }), ...kit], { ledger, isSystemPath: (p) => p.includes("/ui/") });
    expect(r.outcome.status).toBe("committed");
  });

  it("D: identical content is a no-op and never persisted", () => {
    const r = run(base);
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.rejections[0].reason).toBe("no_changes");
  });

  it("E: an out-of-scope mutation is rejected and nothing commits", () => {
    const r = run(edit({ "src/pages/Home.tsx": "v2", "src/components/Header.tsx": "h2" }), {
      protectionReason: (p) => (p.includes("Header") ? "shared navigation/layout was not part of this request" : null),
    });
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.outcome.files).toEqual(base);
    expect(r.rejections[0]).toMatchObject({ path: "src/components/Header.tsx", reason: "scope_violation", recoverable: true });
  });

  it("F: cancellation before commit keeps the previous state", () => {
    const r = run(edit({ "src/pages/Home.tsx": "v2" }), { cancelled: () => true });
    expect(r.outcome.status).toBe("rolled_back");
    if (r.outcome.status === "rolled_back") expect(r.outcome.reason).toBe("cancelled");
    expect(r.outcome.files).toEqual(base);
  });
});
