import { afterEach, describe, expect, it } from "vitest";
import { isAllowedWebhookUrl, verifyServiceKey } from "@/server/service-api.server";

const KEY = "k".repeat(40);
const req = (auth?: string) =>
  new Request("https://x/api/public/v1/projects", { headers: auth ? { authorization: auth } : {} });

describe("service API key", () => {
  afterEach(() => {
    delete process.env.KIMBLE_SERVICE_KEY;
  });
  it("accepts only the exact service key", () => {
    process.env.KIMBLE_SERVICE_KEY = KEY;
    expect(verifyServiceKey(req(`Bearer ${KEY}`))).toBeNull();
    expect(verifyServiceKey(req(`Bearer ${KEY}x`))?.status).toBe(401);
    expect(verifyServiceKey(req()))?.toBeTruthy();
    expect(verifyServiceKey(req())?.status).toBe(401);
  });
  it("refuses everything when no key is configured", () => {
    expect(verifyServiceKey(req(`Bearer ${KEY}`))?.status).toBe(500);
  });
});

describe("webhook targets", () => {
  it("allows public https only", () => {
    expect(isAllowedWebhookUrl("https://api.example.com/hook")).toBe(true);
    expect(isAllowedWebhookUrl("http://api.example.com/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://localhost/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://10.0.0.5/hook")).toBe(false);
    expect(isAllowedWebhookUrl("https://192.168.1.1/hook")).toBe(false);
  });
});
