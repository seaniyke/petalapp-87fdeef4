/**
 * Guards the cost leaks we fixed in the dedicated-backend lifecycle.
 *
 * These are deliberately source-level assertions: the bugs were not in logic
 * we can call in isolation, they were in which side effects the cron jobs
 * perform, and that is exactly what must not come back.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAUSE_MESSAGES } from "../managed-backend.server";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("hourly backend billing", () => {
  const src = read("src/routes/api/public/cron/runtime-backend-hour.ts");

  it("never stamps activity when a charge succeeds", () => {
    // Billing counting as activity kept idle hibernation from ever firing.
    expect(src).not.toMatch(/last_active_at:\s*new Date\(\)/);
  });

  it("pauses with the unpaid reason when the grace window expires", () => {
    expect(src).toContain('pauseForProject(p.id, "unpaid")');
  });
});

describe("idle hibernation", () => {
  const src = read("src/routes/api/public/cron/backend-hibernate.ts");

  it("pauses with the idle reason", () => {
    expect(src).toContain('pauseForProject(b.project_id, "idle")');
  });

  it("does not tell an idle user to top up", () => {
    expect(src).not.toMatch(/Top up to bring it back online/);
  });
});

describe("pause messages", () => {
  it("tells an idle owner it wakes up on its own", () => {
    expect(PAUSE_MESSAGES.idle).toMatch(/wakes up automatically/);
  });

  it("tells an unpaid owner to top up", () => {
    expect(PAUSE_MESSAGES.unpaid).toMatch(/Top up/);
  });
});

describe("disconnect", () => {
  const src = read("src/routes/api/backend.ts");

  it("removes the upstream database instead of orphaning it", () => {
    expect(src).toContain("deleteForProject(parsed.data.projectId)");
  });

  it("caps how many dedicated databases can be live", () => {
    expect(src).toContain('economicsValue("max_active_dedicated_backends")');
  });

  it("funds backends from credits, not the retired dollar balance", () => {
    expect(src).not.toContain("runtime_topup_balance_cents");
  });
});

describe("reaper", () => {
  const src = read("src/routes/api/public/cron/backend-reap.ts");

  it("only reaps databases paused for being unused", () => {
    expect(src).toContain('.eq("pause_reason", "idle")');
  });

  it("warns before deleting", () => {
    expect(src).toContain("delete_warned_at");
  });
});
