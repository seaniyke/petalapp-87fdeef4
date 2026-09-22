import { describe, expect, it } from "vitest";
import {
  humanizeActivity,
  idleLine,
  latestActivityLine,
  pick,
  pictureLine,
} from "@/lib/activity-language";
import { humanFileName } from "@/components/build/FileStack";

describe("humanizeActivity", () => {
  it("says what image generation actually did, in plain words", () => {
    const a = humanizeActivity("image_resolve", "fixed", "Generated 6 images", 6);
    expect(a.title).toBe("Made 6 pictures for your app");
    expect(a.group).toBe("design");
  });

  it("never leaks pipeline jargon for known steps", () => {
    const steps = [
      "rls_sanity",
      "post_stream_autofix",
      "esbuild_parse",
      "npm_preflight",
      "local_verifier",
      "render_risk",
      "file_budget",
      "prd_contract",
      "continuation",
      "stream_autofix",
    ];
    const jargon = /rls|autofix|esbuild|npm|prd|parse guard|verifier/i;
    for (const step of steps) {
      for (const outcome of ["ok", "fixed", "skipped", "failed"] as const) {
        const { title } = humanizeActivity(step, outcome, "Autofix pass — nothing to repair", 2);
        expect(title, `${step}/${outcome}`).not.toMatch(jargon);
      }
    }
  });

  it("falls back to the server message for unknown steps", () => {
    expect(humanizeActivity("brand_new_tier", "ok", "Did a thing").title).toBe("Did a thing");
  });
});

describe("latestActivityLine", () => {
  const now = 1_000_000;

  it("returns the newest step as a human line", () => {
    const line = latestActivityLine(
      [
        { step: "stream_autofix", outcome: "ok", message: "x", ts: now - 5000 },
        { step: "rls_sanity", outcome: "ok", message: "RLS sanity check clean", ts: now - 1000 },
      ],
      now,
    );
    expect(line).toBe("Checked your saved data stays private");
  });

  it("ignores stale activity so the card never fakes being busy", () => {
    expect(
      latestActivityLine([{ step: "rls_sanity", outcome: "ok", message: "x", ts: now - 120_000 }], now),
    ).toBeNull();
  });

  it("handles an empty feed", () => {
    expect(latestActivityLine([], now)).toBeNull();
  });
});
