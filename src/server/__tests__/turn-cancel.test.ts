import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/auth-token", () => ({ getSupabaseAccessToken: async () => "test-token" }));

import {
  registerTurnController,
  abortLocalTurn,
  requestTurnCancel,
  assertTurnActive,
  claimTurnCommit,
  turnAllowsResume,
} from "@/server/turn-cancel.server";
import { guardHandlers, streamGenerate, cancelTurn } from "@/lib/stream";

/** Minimal in-memory stand-in for the service client, `turns` table only.
 *  Records every table touched so tests can prove nothing else is written. */
function fakeDb(rows: Array<{ id: string; user_id: string; status: string; committed_at?: string | null }>) {
  const touched: string[] = [];
  const client = {
    from(table: string) {
      touched.push(table);
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const match = () => rows.filter((r) => filters.every(([k, v]) => ((r as Record<string, unknown>)[k] ?? null) === v));
      const q = {
        select() { return q; },
        update(p: Record<string, unknown>) { patch = p; return q; },
        eq(k: string, v: unknown) { filters.push([k, v]); return q; },
        is(k: string, v: unknown) { filters.push([k, v]); return q; },
        async maybeSingle() { return { data: match()[0] ?? null, error: null }; },
        then(res: (v: unknown) => void) {
          const hit = match();
          if (patch) for (const r of hit) Object.assign(r, patch);
          res({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
      };
      return q;
    },
  };
  return { client: client as never, rows, touched };
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("A. Stop cancels the backend turn", () => {
  it("aborts the registered work controller, stops later AI calls and the build trigger; idempotent", async () => {
    const db = fakeDb([{ id: A, user_id: "u1", status: "running" }]);
    const work = new AbortController();
    const unregister = registerTurnController(A, work);

    const r1 = await requestTurnCancel(A, "u1", db.client);
    expect(r1).toEqual({ ok: true, cancelled: true, status: "aborted" });
    expect(work.signal.aborted).toBe(true);
    expect(db.rows[0].status).toBe("aborted");

    // Pipeline shape: every stage passes a Stop boundary first.
    const aiCall = vi.fn();
    const triggerBuild = vi.fn();
    const check = async () => db.rows[0].status === "aborted";
    await expect(
      (async () => {
        await assertTurnActive(A, work.signal, "page writing", check);
        aiCall();
        await assertTurnActive(A, work.signal, "saving", check);
        triggerBuild();
      })(),
    ).rejects.toThrow(/Stopped by user/);
    expect(aiCall).not.toHaveBeenCalled();
    expect(triggerBuild).not.toHaveBeenCalled();

    const r2 = await requestTurnCancel(A, "u1", db.client);
    expect(r2).toEqual({ ok: true, cancelled: true, status: "aborted" });
    unregister();
  });

  it("a Stop landing on another worker is picked up at the next boundary", async () => {
    const work = new AbortController();
    const unregister = registerTurnController(A, work);
    await expect(assertTurnActive(A, work.signal, "images", async () => true)).rejects.toThrow();
    expect(work.signal.aborted).toBe(true);
    unregister();
  });

  it("cannot cancel another user's turn", async () => {
    const db = fakeDb([{ id: A, user_id: "owner", status: "running" }]);
    const work = new AbortController();
    const unregister = registerTurnController(A, work);
    expect(await requestTurnCancel(A, "intruder", db.client)).toEqual({ ok: false, code: 404 });
    expect(db.rows[0].status).toBe("running");
    expect(work.signal.aborted).toBe(false);
    unregister();
  });

  it("the generate pipeline registers the controller and checks Stop before pages, images and billing", () => {
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).toContain("registerTurnController(recorder.turnId, workController)");
    const pages = src.indexOf('assertActive(turnId, abortSignal, "page writing")');
    const settle = src.indexOf("claimCommit(turnId, abortSignal)");
    expect(pages).toBeGreaterThan(0);
    expect(src.indexOf('assertActive(turnId, abortSignal, "images")')).toBeGreaterThan(0);
    expect(pages).toBeLessThan(src.indexOf("runToolLoop({"));
    expect(settle).toBeLessThan(src.indexOf("agentIO().settleCharge("));
    expect(settle).toBeLessThan(src.indexOf("agentIO().replaceFiles("));
    // Explicit Stop forces the terminal status to aborted (never succeeded → no server build trigger).
    expect(src).toMatch(/workController\.signal\.aborted && terminalStatus !== "awaiting_credits"\) \{\s*terminalStatus = "aborted"/);
  });
});

describe("B. Stop race: Turn A's cancel cannot touch Turn B", () => {
  it("cancelling A leaves B's controller and row alone", async () => {
    const db = fakeDb([
      { id: A, user_id: "u1", status: "running" },
      { id: B, user_id: "u1", status: "running" },
    ]);
    const workA = new AbortController();
    const workB = new AbortController();
    const unA = registerTurnController(A, workA);
    const unB = registerTurnController(B, workB);
    await requestTurnCancel(A, "u1", db.client);
    await requestTurnCancel(A, "u1", db.client); // late duplicate
    expect(workA.signal.aborted).toBe(true);
    expect(workB.signal.aborted).toBe(false);
    expect(db.rows[1].status).toBe("running");
    expect(abortLocalTurn("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toBe(false);
    unA();
    unB();
  });
});

describe("C. Late SSE events from an old turn are ignored", () => {
  it("guarded handlers stop mutating once another turn is active", () => {
    let active: object = {};
    const tokenA = active;
    const seen: string[] = [];
    const h = guardHandlers(
      {
        onPhase: (p) => seen.push(`phase:${p}`),
        onFileComplete: (path) => seen.push(`file:${path}`),
        onNarration: (t) => seen.push(`narr:${t}`),
        onError: (m) => seen.push(`err:${m}`),
        onDone: (s) => seen.push(`done:${s}`),
      },
      () => active === tokenA,
    );
    h.onPhase?.("writing");
    active = {}; // Turn B starts
    h.onPhase?.("polishing");
    (h.onFileComplete as unknown as (...a: unknown[]) => void)?.("src/pages/Home.tsx", 1, 1);
    (h.onNarration as unknown as (...a: unknown[]) => void)?.("late", "x");
    h.onError?.("late failure" as never);
    h.onDone?.("failed");
    expect(seen).toEqual(["phase:writing"]);
  });
});

describe("D. A plain disconnect still resumes (Stop is not involved)", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("EOF without done replays through /events and never calls /cancel", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      const body = url.includes("/events")
        ? [{ type: "done", status: "succeeded" }]
        : [{ type: "turn_id", turnId: A }];
      const text = body.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(text, { status: 200 });
    });
    let done: string | null = null;
    await streamGenerate(
      { messages: [{ role: "user", content: "x" }], currentFiles: [] },
      { onDone: (s) => { done = s; } },
    );
    expect(done).toBe("succeeded");
    expect(calls.some((u) => u.includes(`/api/turns/${A}/events`))).toBe(true);
    expect(calls.some((u) => u.includes("/cancel"))).toBe(false);
  }, 15_000);
});

describe("E. Cancelling a finished turn is harmless", () => {
  it("reports already finished and leaves the row unchanged", async () => {
    const db = fakeDb([{ id: A, user_id: "u1", status: "succeeded" }]);
    expect(await requestTurnCancel(A, "u1", db.client)).toEqual({ ok: true, cancelled: false, status: "succeeded" });
    expect(db.rows[0].status).toBe("succeeded");
  });

  it("client helper distinguishes cancelled / finished / unconfirmed", async () => {
    vi.restoreAllMocks();
    const spy = vi.spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(Response.json({ cancelled: true, status: "aborted" }));
    expect(await cancelTurn(A)).toEqual({ state: "cancelled" });
    spy.mockResolvedValueOnce(Response.json({ cancelled: false, status: "succeeded" }));
    expect(await cancelTurn(A)).toEqual({ state: "already_finished", status: "succeeded" });
    spy.mockRejectedValueOnce(new Error("offline"));
    expect(await cancelTurn(A)).toEqual({ state: "unconfirmed" });
  });
});

describe("F. Cancel after partial work never rolls the project back", () => {
  it("cancel only writes the turns row — no project files, builds or billing tables", async () => {
    const db = fakeDb([{ id: A, user_id: "u1", status: "running" }]);
    await requestTurnCancel(A, "u1", db.client);
    expect(new Set(db.touched)).toEqual(new Set(["turns"]));
    const src = readFileSync("src/server/turn-cancel.server.ts", "utf8");
    expect(src).not.toMatch(/project_files|replace_project_files|refund|project_builds/);
  });
});

describe("Race: Stop vs completion has exactly one winner", () => {
  it("Stop wins before the commit point: commit refuses, nothing is charged, saved or built", async () => {
    const db = fakeDb([{ id: A, user_id: "u1", status: "running", committed_at: null }]);
    const work = new AbortController();
    const un = registerTurnController(A, work);
    expect(await requestTurnCancel(A, "u1", db.client)).toEqual({ ok: true, cancelled: true, status: "aborted" });
    const charge = vi.fn();
    const save = vi.fn();
    const build = vi.fn();
    await expect(
      (async () => {
        await claimTurnCommit(A, undefined, db.client); // other worker: signal not aborted locally
        charge(); save(); build();
      })(),
    ).rejects.toThrow(/Stopped by user/);
    expect([charge, save, build].every((f) => f.mock.calls.length === 0)).toBe(true);
    expect(db.rows[0].committed_at ?? null).toBeNull();
    un();
  });

  it("completion wins at the commit point: Stop reports 'completing', never 'Stopped', and the work controller keeps running", async () => {
    const db = fakeDb([{ id: A, user_id: "u1", status: "running", committed_at: null }]);
    const work = new AbortController();
    const un = registerTurnController(A, work);
    await claimTurnCommit(A, work.signal, db.client);
    expect(db.rows[0].committed_at).toBeTruthy();
    const r = await requestTurnCancel(A, "u1", db.client);
    expect(r).toEqual({ ok: true, cancelled: false, status: "completing" });
    expect(db.rows[0].status).toBe("running");
    expect(work.signal.aborted).toBe(false);
    un();
  });

  it("after the turn finished, Stop reports the real terminal state", async () => {
    for (const status of ["succeeded", "failed"]) {
      const db = fakeDb([{ id: A, user_id: "u1", status, committed_at: "t" }]);
      expect(await requestTurnCancel(A, "u1", db.client)).toEqual({ ok: true, cancelled: false, status });
      expect(db.rows[0].status).toBe(status);
    }
  });

  it("a missing turn row (tracking off) never blocks a build", async () => {
    const db = fakeDb([]);
    await expect(claimTurnCommit(A, undefined, db.client)).resolves.toBeUndefined();
  });

  it("the UI only says Stopped on a server-confirmed cancel", () => {
    const src = readFileSync("src/routes/builder.tsx", "utf8");
    const i = src.indexOf('toast.success("Stopped.');
    expect(src.lastIndexOf('if (r.state === "cancelled")', i)).toBeGreaterThan(src.indexOf("const stopGeneration"));
    expect(src).toContain("That request had already finished — showing the result.");
  });
});

describe("Queued silent retry respects a Stop", () => {
  it("only an explicitly stopped turn is refused", () => {
    expect(turnAllowsResume("aborted")).toBe(false);
    // interrupted turns close as failed; repair rounds follow succeeded builds
    expect(turnAllowsResume("failed")).toBe(true);
    expect(turnAllowsResume("succeeded")).toBe(true);
    expect(turnAllowsResume(null)).toBe(true);
  });
});
