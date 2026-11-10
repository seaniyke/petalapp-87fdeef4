import { describe, expect, it } from "vitest";
import { RESET_RULES, googleConfigured, isSiteAddress, pagesProjectName, withFragment } from "../shared-auth-rules";

const hosts = {
  subdomain: "hearth",
  pagesProject: pagesProjectName("955a00dc-0a1c-40ea-907e-af983697f5a3"),
  domains: ["recipes.example.com"],
};

describe("where reset links and Google sign-in may return", () => {
  it("allows the site's own addresses", () => {
    expect(isSiteAddress("https://hearth.buildwithpetal.com/reset-password", hosts)).toBe(true);
    expect(isSiteAddress("https://hearth.sites.custardai.dev/login", hosts)).toBe(true);
    expect(isSiteAddress("https://petal-955a00dc0a1c.pages.dev/", hosts)).toBe(true);
    expect(isSiteAddress("https://abc123.petal-955a00dc0a1c.pages.dev/x", hosts)).toBe(true);
    expect(isSiteAddress("https://recipes.example.com/reset-password", hosts)).toBe(true);
  });
  it("refuses anyone else's address", () => {
    expect(isSiteAddress("https://evil.com/reset-password", hosts)).toBe(false);
    expect(isSiteAddress("https://other.buildwithpetal.com/", hosts)).toBe(false);
    expect(isSiteAddress("https://petal-955a00dc0a1c.pages.dev.evil.com/", hosts)).toBe(false);
    expect(isSiteAddress("https://evilpetal-955a00dc0a1c.pages.dev/", hosts)).toBe(false);
    expect(isSiteAddress("http://recipes.example.com/", hosts)).toBe(false);
    expect(isSiteAddress("https://user:pw@recipes.example.com/", hosts)).toBe(false);
    expect(isSiteAddress("javascript:alert(1)", hosts)).toBe(false);
  });
  it("puts the secret in the #fragment only", () => {
    expect(withFragment("https://recipes.example.com/reset-password?x=1#old", "petal_reset", "a b")).toBe(
      "https://recipes.example.com/reset-password?x=1#petal_reset=a%20b",
    );
  });
});

describe("reset limits", () => {
  it("links last one hour; 3 emails per account and 50 per site each hour", () => {
    expect(RESET_RULES.ttlMs).toBe(3_600_000);
    expect(RESET_RULES.perUserPerHour).toBe(3);
    expect(RESET_RULES.perProjectPerHour).toBe(50);
  });
});

describe("Google availability", () => {
  it("needs both Petal Google app secrets", () => {
    expect(googleConfigured({})).toBe(false);
    expect(googleConfigured({ PETAL_GOOGLE_CLIENT_ID: "x" })).toBe(false);
    expect(googleConfigured({ PETAL_GOOGLE_CLIENT_ID: "x", PETAL_GOOGLE_CLIENT_SECRET: "y" })).toBe(true);
  });
});
