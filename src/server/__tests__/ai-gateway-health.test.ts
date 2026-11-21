import { describe, expect, it } from "vitest";
import { classifyGatewayFailure, failureLabel, verdictFrom, gatewayAlertAction } from "@/server/ai-gateway-health.server";

const at = new Date().toISOString();

describe("AI gateway health", () => {
  it("names a stale key as key_not_registered and operator-only", () => {
    const f = classifyGatewayFailure(403, JSON.stringify({ error: { type: "lovable_api_key_not_registered", message: "LOVABLE_API_KEY is not registered for this project" } }));
    expect(f.kind).toBe("key_not_registered");
    expect(f.needsOperator).toBe(true);
  });
  it("treats 429 and 5xx as transient", () => {
    expect(classifyGatewayFailure(429, "").needsOperator).toBe(false);
    expect(classifyGatewayFailure(503, "boom").kind).toBe("unavailable");
  });
  it("reports down when the newest call was refused by a stale key", () => {
    const f = classifyGatewayFailure(403, '{"message":"key not registered"}');
    expect(verdictFrom([{ status: 403, error_message: failureLabel(403, f), created_at: at }]).state).toBe("down");
  });
  it("one success after failures means healthy", () => {
    expect(verdictFrom([{ status: 200, error_message: null, created_at: at }, { status: 403, error_message: "HTTP 403", created_at: at }]).state).toBe("ok");
  });
  it("a rate limit alone is not an outage", () => {
    const f = classifyGatewayFailure(429, "");
    expect(verdictFrom([{ status: 429, error_message: failureLabel(429, f), created_at: at }]).state).toBe("unknown");
  });
  it("emails once per outage and re-arms on recovery", () => {
    expect(gatewayAlertAction("down", null)).toBe("send");
    expect(gatewayAlertAction("down", at)).toBe("none");
    expect(gatewayAlertAction("ok", at)).toBe("rearm");
  });
});
