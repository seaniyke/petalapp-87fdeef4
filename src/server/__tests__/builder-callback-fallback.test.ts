import { describe, expect, it } from "vitest";
import { callbackCandidates } from "../../../builder/src/callback-urls";

describe("builder callback fallback", () => {
  it("keeps the configured callback and adds the stable project endpoint", () => {
    expect(callbackCandidates("https://buildwithpetal.com/api/builds/callback")).toEqual([
      "https://buildwithpetal.com/api/builds/callback",
      "https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/builds/callback",
    ]);
  });

  it("deduplicates the stable endpoint when it is already configured", () => {
    expect(
      callbackCandidates(
        "https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/builds/callback",
      ),
    ).toHaveLength(1);
  });
});