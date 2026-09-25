import { describe, expect, it, vi } from "vitest";
import { TurnLedger, commitTurn, type SourceVerification } from "@/server/execution";
import { verifyProposedSource } from "@/server/verification/source.server";
import { browserGate, buildGate, finalizeVerification, runSourceGates } from "@/server/verification/gates";

const pkg = { path: "package.json", content: JSON.stringify({ dependencies: { react: "18" } }) };
const base = [
  pkg,
  { path: "index.html", content: "<div id=root></div>" },
  { path: "src/pages/Home.tsx", content: "export default function Home() { return <main>Home page content here</main>; }\n" },
];
const edit = (content: string) => base.map((f) => (f.path === "src/pages/Home.tsx" ? { ...f, content } : f));

const commit = (proposed: typeof base, verifySource: (t: typeof base, c: string[]) => Promise<SourceVerification>, cancelled = false) =>
  commitTurn({
    baseline: base,
    proposed,
    ledger: new TurnLedger(),
    isSystemPath: () => false,
    protectionReason: () => null,
    checks: [],
    cancelled: () => cancelled,
    verifySource,
  });
const real = (t: typeof base, c: string[]) => verifyProposedSource({ tree: t, changedPaths: c, requestedRoutes: [] });
const good = "export default function Home() { return <main>Welcome to the new home page</main>; }\n";

describe("authoritative source verification", () => {
  it("A/M: PASS commits and leaves the project IN_PROGRESS (build pending), never READY", async () => {
    const r = await commit(edit(good), real);
    expect(r.outcome.status).toBe("committed");
    expect(r.verification?.status).toBe("IN_PROGRESS");
  });

  it("B: WARNING commits and the warning is recorded", async () => {
    const withDep = good.replace("export", 'import x from "left-pad";\nexport');
    const r = await commit(edit(withDep), real);
    expect(r.outcome.status).toBe("committed");
    expect(r.verification?.gates.find((g) => g.gate === "dependencies")?.verdict).toBe("WARNING");
  });

  it("C/E/F/G: FAILED blocks commit with a structured rejection (nothing to persist, bill or report as success)", async () => {
    const r = await commit(edit("export default function Home( { return <main>"), real);
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.outcome.files).toEqual(base);
    expect(r.verification?.status).toBe("FAILED");
    expect(r.rejections[0]).toMatchObject({ stage: "source_verification", gate: "syntax", reason: "validation_failed", path: "src/pages/Home.tsx" });
  });

  it("D: UNVERIFIED (checker unavailable) blocks commit and is never READY", async () => {
    const r = await commit(edit(good), async () => finalizeVerification(runSourceGates({ files: edit(good), requestedRoutes: [], esbuild: { status: "unavailable" } })));
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.verification?.status).toBe("UNVERIFIED");
    expect(r.rejections[0].reason).toBe("unverified");
  });

  it("a verifier that throws is UNVERIFIED, not PASS", async () => {
    const r = await commit(edit(good), async () => { throw new Error("boom"); });
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.verification?.status).toBe("UNVERIFIED");
  });

  it("H: cancellation before commit rolls back and skips verification", async () => {
    const spy = vi.fn(real);
    const r = await commit(edit(good), spy, true);
    expect(r.outcome.status).toBe("rolled_back");
    expect(spy).not.toHaveBeenCalled();
  });

  it("I/J: verification sees the proposed bytes, not the old state or an earlier verdict", async () => {
    let seen = "";
    const r = await commit(edit(good), async (t, c) => {
      seen = t.find((f) => f.path === "src/pages/Home.tsx")!.content;
      expect(c).toEqual(["src/pages/Home.tsx"]);
      return real(t, c);
    });
    expect(seen).toBe(good);
    expect(r.outcome.status).toBe("committed");
    // A valid baseline cannot authorize a broken proposal.
    const bad = await commit(edit("export default ("), real);
    expect(bad.outcome.status).toBe("rolled_back");
  });

  it("K: build failure after source PASS is not READY", () => {
    const src = runSourceGates({ files: edit(good), requestedRoutes: [], esbuild: { status: "passed" } });
    expect(finalizeVerification([...src, buildGate("failed", "vite error")]).status).toBe("FAILED");
  });

  it("L: runtime failure after build success is not READY", () => {
    const src = runSourceGates({ files: edit(good), requestedRoutes: [], esbuild: { status: "passed" } });
    const rec = finalizeVerification([...src, buildGate("succeeded"), browserGate({ verdict: "not_ready", reasons: ["blank page"] })]);
    expect(rec.status).toBe("FAILED");
    const unv = finalizeVerification([...src, buildGate("succeeded"), browserGate({ verdict: "unverified", reasons: [] })]);
    expect(unv.status).toBe("UNVERIFIED");
    const ok = finalizeVerification([...src, buildGate("succeeded"), browserGate({ verdict: "ready", reasons: [] })]);
    expect(ok.status).toBe("READY");
  });
});
