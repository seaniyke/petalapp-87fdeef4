import { describe, expect, it } from "vitest";
import { isInfrastructureBuildError, friendlyBuildServiceBusy } from "@/lib/friendly-errors";
import { MAX_BUILD_RETRIES } from "@/server/build-retry.server";

describe("infrastructure build failures", () => {
  it("recognises every shape the builder has produced", () => {
    for (const raw of [
      "The operation was aborted due to timeout",
      "Could not reach build service after 2 attempts: fetch failed",
      "The build service didn't respond after multiple attempts. Please try again in a moment.",
      "Cloudflare responded 502",
    ]) {
      expect(isInfrastructureBuildError(raw), raw).toBe(true);
    }
  });

  it("does not misread an app-code failure as infrastructure", () => {
    expect(
      isInfrastructureBuildError("src/App.tsx(3,1): error TS2304: Cannot find name 'foo'"),
    ).toBe(false);
  });

  it("offers a calm retry instead of asking the user to fix their app", () => {
    const friendly = friendlyBuildServiceBusy("The operation was aborted due to timeout");
    expect(friendly.actionKind).toBe("retry");
    expect(friendly.message).not.toMatch(/timeout|Cloudflare|abort/i);
  });

  it("gives a blip enough room to heal itself", () => {
    expect(MAX_BUILD_RETRIES).toBeGreaterThanOrEqual(4);
  });
});
