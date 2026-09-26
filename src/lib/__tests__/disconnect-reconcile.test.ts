/**
 * Disconnect scenarios exercised through the real client paths:
 * `streamGenerate` (the only browser caller of /api/generate) and
 * `reconcileAuthoritativeTurn` (persisted state decides the outcome).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown> | null;
const tables: Record<string, Row> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      const api = { select: () => api, eq: () => api, maybeSingle: async () => ({ data: tables[table] ?? null, error: null }) };
      return api;
    },
  },
}));
vi.mock("@/lib/auth-token", () => ({ getSupabaseAccessToken: async () => "tok" }));

import { reconcileAuthoritativeTurn, isNonFailure } from "@/lib/turn-reconcile";
import { streamGenerate } from "@/lib/stream";

const set = (turn: Row, project: Row = null, build: Row = null) => {
  tables.turns = turn;
  tables.projects = project;
  tables.project_builds = build;
};

function sseBody(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
}

beforeEach(() => set(null));

describe("disconnect / reconcile", () => {
  it("A: disconnect AFTER commit → success discovered, charged once, no regeneration", async () => {
    set({ status: "succeeded", committed_revision: 4, error_message: null, credits_charged: 1 }, { revision: 4, latest_build_id: "b" }, { status: "ready", project_revision: 4 });
    const v = await reconcileAuthoritativeTurn("p", "t");
    expect(v.state).toBe("SUCCEEDED");
    expect(v.creditsCharged).toBe(1);

    // Resending the same turn id: server answers 409 → client attaches to the
    // event log, it never POSTs a second generation.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/generate") return new Response("Turn already accepted", { status: 409, headers: { "x-kimble-turn-id": "t" } });
      return new Response(sseBody([{ type: "done" }]), { status: 200 });
    }));
    await streamGenerate({ projectId: "p", turnId: "t", messages: [] } as never, {} as never);
    expect(calls.filter((c) => c.startsWith("POST /api/generate"))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith("GET /api/turns/t/events"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("B: disconnect DURING execution → persisted RUNNING, UI resumes (not a failure)", async () => {
    set({ status: "running", committed_revision: null, error_message: null, credits_charged: 0 });
    const v = await reconcileAuthoritativeTurn("p", "t");
    expect(v.state).toBe("RUNNING");
    expect(isNonFailure(v.state)).toBe(true);
  });

  it("C: disconnect BEFORE commit → no guessing; persisted state decides", async () => {
    set(null);
    expect((await reconcileAuthoritativeTurn("p", "t")).state).toBe("UNKNOWN");
    set({ status: "failed", committed_revision: null, error_message: "verification_failed", credits_charged: 0 });
    const v = await reconcileAuthoritativeTurn("p", "t");
    expect(v.state).toBe("FAILED");
    expect(v.committed).toBe(false);
    expect(v.creditsCharged).toBe(0);
  });

  it("D: refresh mid-execution → current execution reconstructed from the turn row", async () => {
    set({ status: "succeeded", committed_revision: 7, error_message: null, credits_charged: 1 }, { revision: 7, latest_build_id: "b" }, { status: "building", project_revision: 7 });
    expect((await reconcileAuthoritativeTurn("p", "t")).state).toBe("BUILDING");
  });

  it("E: network loss/regain → transport error is not a fake build failure", async () => {
    set({ status: "running", committed_revision: null, error_message: null, credits_charged: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Load failed"); }));
    const err = await streamGenerate({ projectId: "p", turnId: "t", messages: [] } as never, {} as never).then(() => null, (e) => e);
    vi.unstubAllGlobals();
    const { toFriendlyError } = await import("@/lib/friendly-errors");
    expect(toFriendlyError(err).title).not.toMatch(/failed/i);
    expect(isNonFailure((await reconcileAuthoritativeTurn("p", "t")).state)).toBe(true);
  });
});
