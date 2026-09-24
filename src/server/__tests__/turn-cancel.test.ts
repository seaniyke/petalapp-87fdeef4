import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/auth-token", () => ({ getSupabaseAccessToken: async () => "test-token" }));

import {
  registerTurnController,
  abortLocalTurn,
  requestTurnCancel,
  assertTurnActive,
} from "@/server/turn-cancel.server";
import { guardHandlers, streamGenerate, cancelTurn } from "@/lib/stream";

/** Minimal in-memory stand-in for the service client, `turns` table only.
 *  Records every table touched so tests can prove nothing else is written. */
function fakeDb(rows: Array<{ id: string; user_id: string; status: string }>) {
  const touched: string[] = [];
  const client = {
    from(table: string) {
      touched.push(table);
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      const match = () => rows.filter((r) => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      const q = {
        select() { return q; },
        update(p: Record<string, unknown>) { patch = p; return q; },
        eq(k: string, v: unknown) { filters.push([k, v]); return q; },
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
    const pages = src.indexOf('assertTurnActive(turnId, abortSignal, "page writing")');
    const settle = src.indexOf('assertTurnActive(turnId, abortSignal, "saving")');
    expect(pages).toBeGreaterThan(0);
    expect(src.indexOf('assertTurnActive(turnId, abortSignal, "images")')).toBeGreaterThan(0);
    expect(pages).toBeLessThan(src.indexOf("await writePlannedPages("));
    expect(settle).toBeLessThan(src.indexOf('"settle_build_charge"'));
    expect(settle).toBeLessThan(src.indexOf('"replace_project_files"'));
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
    h.onPhase?.("live");
    h.onFileComplete?.("src/pages/Home.tsx" as never, 1 as never);
    h.onNarration?.("late" as never);
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
