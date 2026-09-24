import { describe, it, expect, vi } from "vitest";

const calls = { claim: 0, blocked: [] as string[], files: 0 };
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => { calls.files++; return { select: () => ({ eq: async () => ({ data: [] }) }) }; } },
}));
vi.mock("@/server/rate-limit.server", () => ({ secretsMatch: () => true }));
vi.mock("@/server/credit-pause.server", () => ({ recoverApplyingCreditPauses: async () => 0 }));
vi.mock("@/server/turn-completion.server", () => ({
  INTERRUPTED_MARKER: "interrupted_generation",
  listResumable: async () => [],
  claimResumeAttempt: async () => { calls.claim++; return true; },
  markBlocked: async (_id: string, reason: string) => { calls.blocked.push(reason); },
}));
vi.mock("@/server/turn-cancel.server", async (orig) => ({
  ...(await orig<typeof import("@/server/turn-cancel.server")>()),
  turnStatusOf: async () => "aborted",
}));

import { resumeOne } from "@/routes/api/public/cron/turn-resume";

describe("queued silent retry after Stop", () => {
  it("Turn A queued → Stop → aborted → retry runs and exits without AI, files, billing or build", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await resumeOne(
      {
        id: "rec", project_id: "p", turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "u",
        stage: "needs_repair" as never, attempts: 0, max_attempts: 3,
        outstanding_defects: ["make a bakery site"], defect_fingerprint: null, last_build_id: null,
        accepted: false, evidence: ["interrupted_generation"], terminal_reason: null, resume_after: null,
      },
      "http://localhost",
    );
    expect(out).toBe("stopped");
    expect(calls.claim).toBe(0); // no attempt spent
    expect(calls.files).toBe(0); // no project files read/written
    expect(fetchSpy).not.toHaveBeenCalled(); // no /api/generate → no AI, billing or build
    expect(calls.blocked).toHaveLength(1);
  });
});
