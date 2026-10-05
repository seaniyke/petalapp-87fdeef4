import { describe, expect, it } from "vitest";
import {
  OAUTH_PROVIDERS, buildAuthorizeUrl, decryptToken, encryptToken, providerReady, signState, verifyState,
} from "@/server/connectors/oauth.server";
import { CONNECTORS } from "@/lib/connectors/catalog";

const K = "k".repeat(64);

describe("connector oauth", () => {
  it("round-trips signed state and rejects tampering and expiry", async () => {
    const s = await signState(K, { u: "u", p: "p", c: "github", r: "https://x", exp: Date.now() + 1000 });
    expect((await verifyState(K, s))?.c).toBe("github");
    expect(await verifyState("other", s)).toBeNull();
    expect(await verifyState(K, s.slice(0, -2) + "aa")).toBeNull();
    expect(await verifyState(K, s, Date.now() + 5000)).toBeNull();
  });
  it("encrypts tokens", async () => {
    const c = await encryptToken(K, "secret-token");
    expect(c).not.toContain("secret-token");
    expect(await decryptToken(K, c)).toBe("secret-token");
  });
  it("is ready only with credentials", () => {
    expect(providerReady("github", {})).toBe(false);
    expect(providerReady("github", { GITHUB_CONNECT_CLIENT_ID: "a", GITHUB_CONNECT_CLIENT_SECRET: "b", CONNECTOR_TOKEN_KEY: K })).toBe(true);
  });
  it("builds a consent url", () => {
    const u = new URL(buildAuthorizeUrl(OAUTH_PROVIDERS.google_calendar, "cid", "https://x/cb", "st"));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("st");
  });
  it("every provider has a hub entry", () => {
    for (const id of Object.keys(OAUTH_PROVIDERS)) expect(CONNECTORS.some((c) => c.id === id && c.auth === "oauth")).toBe(true);
  });
});
