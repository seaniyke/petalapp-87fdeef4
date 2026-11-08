import { describe, it, expect } from "vitest";
import { toResult, mapStatus, applyMarkup, parseRegistrantContact } from "../domain-name-api.server";

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

import { termsFromCatalogue, tldOf, validateRecord } from "../domain-name-api.server";

describe("renewal prices come from the registrar catalogue", () => {
  const item = {
    name: "co", registrationPeriods: [1, 2, 3, 4, 5], renewalPeriods: [1, 2, 3],
    isPrivacyAvailable: true,
    prices: [{ priceGroup: "Reseller", renew: [{ period: 1, price: 38.99, currency: "USD" }, { period: 2, price: 77.98, currency: "USD" }] }],
  };
  it(".co renews at $38.99, not its $19.49 first-year price", () => {
    expect(termsFromCatalogue(item, "Reseller").renewCents).toBe(3899);
  });
  it("multi-year renewal uses the listed price for that term", () => {
    expect(termsFromCatalogue(item, "Reseller").renewByPeriod[2]).toBe(7798);
  });
  it("co.uk is recognised as its own ending", () => {
    expect(tldOf("acme.co.uk", new Map([["uk", 1], ["co.uk", 1]]))).toBe("co.uk");
  });
});

describe("DNS record rules", () => {
  it("rejects a CNAME at the root", () => {
    expect(validateRecord({ name: "@", type: "CNAME", values: ["x.com"] })).toBe("cname_at_apex_use_alias");
  });
  it("rejects a non-IPv4 A record", () => {
    expect(validateRecord({ name: "@", type: "A", values: ["abc"] })).toBe("invalid_ipv4");
  });
  it("accepts a valid MX record", () => {
    expect(validateRecord({ name: "@", type: "MX", values: ["10 mail.acme.com"] })).toBeNull();
  });
});
