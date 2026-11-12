import { describe, expect, it } from "vitest";
import { custardGoLink, isAllowedPreviewUrl, phonePreviewUrl } from "../custard-go";

const PID = "955a00dc-0a1c-40ea-907e-af983697f5a3";

describe("Custard Go phone preview", () => {
  it("phones open the app screens on the project's preview address", () => {
    expect(phonePreviewUrl(PID)).toBe("https://preview--955a00dc0a1c40ea907eaf983697f5a3.sites.custardai.dev/?petal_app=1");
  });
  it("deep link opens that address inside Custard Go", () => {
    expect(custardGoLink(PID)).toBe(`custardgo://open?url=${encodeURIComponent(phonePreviewUrl(PID))}`);
  });
  it("Custard Go only loads Custard preview addresses", () => {
    expect(isAllowedPreviewUrl(phonePreviewUrl(PID))).toBe(true);
    expect(isAllowedPreviewUrl("https://evil.com/?x=preview--a.sites.custardai.dev")).toBe(false);
    expect(isAllowedPreviewUrl("http://preview--a.sites.custardai.dev/")).toBe(false);
    expect(isAllowedPreviewUrl("https://shop.sites.custardai.dev/")).toBe(false);
  });
});
