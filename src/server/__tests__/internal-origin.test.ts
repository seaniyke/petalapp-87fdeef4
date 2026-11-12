import { describe, expect, it } from "vitest";
import { internalOrigin } from "@/server/internal-origin";

describe("scheduled jobs call Petal on an address that accepts private routes", () => {
  it("the stable lovable.app host is swapped for the primary address", () => {
    expect(internalOrigin("https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/turn-resume")).toBe("https://api.custardai.dev");
  });
  it("the redirecting published host is swapped too", () => {
    expect(internalOrigin("https://petalapp.lovable.app/api/public/cron/turn-resume")).toBe("https://api.custardai.dev");
  });
  it("local development keeps its own origin", () => {
    expect(internalOrigin("http://localhost:8080/api/public/cron/turn-resume")).toBe("http://localhost:8080");
  });
});
