import { describe, it, expect } from "vitest";
import { toResult, mapStatus, applyMarkup, parseRegistrantContact } from "./domain-name-api.server";

describe("Domain Name API rules", () => {
  it("charges registrar price + 25%", () => {
    expect(applyMarkup(1199)).toBe(1499);
  });

  it("an available $11.99 .com is offered at $14.99", () => {
    const r = toResult({ domainName: "acme.com", status: "AVAILABLE", reason: null, isPremium: false,
      isDocumentRequired: false, price: 11.99, currency: "USD", period: 1 });
    expect(r.available).toBe(true);
    expect(r.priceCents).toBe(1499);
  });

  it("a taken domain is not offered even when the lookup succeeded", () => {
    const r = toResult({ domainName: "google.com", status: "NOTAVAILABLE", reason: "Domain exists",
      isPremium: false, isDocumentRequired: false, price: 11.99, currency: "USD", period: 1 });
    expect(r.available).toBe(false);
  });

  it("names needing registry documents are not sold", () => {
    const r = toResult({ domainName: "x.com.tr", status: "AVAILABLE", reason: null, isPremium: false,
      isDocumentRequired: true, price: 10, currency: "USD", period: 1 });
    expect(r.available).toBe(false);
  });

  it("only Active counts as registered; waiting stays in progress", () => {
    expect(mapStatus("Active")).toBe("succeeded");
    expect(mapStatus("WaitingForRegistration")).toBe("in_progress");
    expect(mapStatus("WaitingForDocument")).toBe("action_required");
  });

  it("converts the stored Cloudflare-style contact", () => {
    const c = parseRegistrantContact(JSON.stringify({
      email: "a@b.com", phone: "+234.8012345678",
      postal_info: { name: "Ike Madu", address: { street: "1 Road", city: "Lagos", postal_code: "100001", country_code: "ng" } },
    }));
    expect(c).toMatchObject({ firstName: "Ike", lastName: "Madu", country: "NG", phoneCountryCode: "234", phone: "8012345678" });
  });
});
