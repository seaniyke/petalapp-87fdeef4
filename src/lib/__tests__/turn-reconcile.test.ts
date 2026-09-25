import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown> | null;

const tables: Record<string, Row> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
      };
      return api;
    },
  },
}));

import { reconcileAuthoritativeTurn, isNonFailure } from "@/lib/turn-reconcile";

function setState(opts: {
  turn?: Row;
  project?: Row;
  build?: Row;
}) {
  tables["turns"] = opts.turn ?? null;
  tables["projects"] = opts.project ?? null;
  tables["project_builds"] = opts.build ?? null;
}

describe("reconcileAuthoritativeTurn", () => {
  beforeEach(() => setState({}));

  it("reports SUCCEEDED when the server committed and the build is ready", async () => {
    setState({
      turn: { status: "succeeded", committed_revision: 4, error_message: null, credits_charged: 1 },
      project: { revision: 4, latest_build_id: "b1" },
      build: { status: "ready", project_revision: 4 },
    });
    const v = await reconcileAuthoritativeTurn("p1", "t1");
    expect(v.state).toBe("SUCCEEDED");
    expect(v.committed).toBe(true);
    expect(v.committedRevision).toBe(4);
  });

  it("reports BUILDING while the committed revision is still compiling", async () => {
    setState({
      turn: { status: "succeeded", committed_revision: 5, error_message: null, credits_charged: 1 },
      project: { revision: 5, latest_build_id: "b2" },
      build: { status: "building", project_revision: 5 },
    });
    expect((await reconcileAuthoritativeTurn("p1", "t1")).state).toBe("BUILDING");
  });

  it("ignores a stale build from an older revision", async () => {
    setState({
      turn: { status: "succeeded", committed_revision: 6, error_message: null, credits_charged: 1 },
      project: { revision: 6, latest_build_id: "b0" },
      build: { status: "building", project_revision: 3 },
    });
    const v = await reconcileAuthoritativeTurn("p1", "t1");
    expect(v.state).toBe("SUCCEEDED");
    expect(v.buildStatus).toBeNull();
  });

  it("reports RUNNING while the turn is still executing server-side", async () => {
    setState({
      turn: { status: "running", committed_revision: null, error_message: null, credits_charged: null },
      project: { revision: 3, latest_build_id: null },
    });
    expect((await reconcileAuthoritativeTurn("p1", "t1")).state).toBe("RUNNING");
  });

  it("surfaces the server's own message on a real failure", async () => {
    setState({
      turn: {
        status: "failed",
        committed_revision: null,
        error_message: "worker_lost: the build server stopped responding",
        credits_charged: 0,
      },
      project: { revision: 3, latest_build_id: null },
    });
    const v = await reconcileAuthoritativeTurn("p1", "t1");
    expect(v.state).toBe("FAILED");
    expect(v.errorMessage).toContain("worker_lost");
    expect(v.committed).toBe(false);
  });

  it("reports WAITING_FOR_USER when the turn paused for credits", async () => {
    setState({
      turn: { status: "awaiting_credits", committed_revision: null, error_message: null, credits_charged: null },
      project: { revision: 3, latest_build_id: null },
    });
    expect((await reconcileAuthoritativeTurn("p1", "t1")).state).toBe("WAITING_FOR_USER");
  });

  it("returns UNKNOWN with no turn id and with no turn row", async () => {
    expect((await reconcileAuthoritativeTurn("p1", null)).state).toBe("UNKNOWN");
    setState({ project: { revision: 1, latest_build_id: null } });
    expect((await reconcileAuthoritativeTurn("p1", "missing")).state).toBe("UNKNOWN");
  });

  it("treats every non-terminal-failure state as 'do not show an error'", () => {
    expect(isNonFailure("SUCCEEDED")).toBe(true);
    expect(isNonFailure("BUILDING")).toBe(true);
    expect(isNonFailure("RUNNING")).toBe(true);
    expect(isNonFailure("WAITING_FOR_USER")).toBe(true);
    expect(isNonFailure("FAILED")).toBe(false);
    expect(isNonFailure("UNKNOWN")).toBe(false);
  });
});
