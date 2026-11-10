import { describe, expect, it } from "vitest";
import {
  embedUrl,
  frameAncestorsCsp,
  isEmbedToken,
  newEmbedToken,
  normalizeEmbedOrigin,
  previewHost,
  projectIdFromPreviewSlug,
} from "../embed-preview";
import { openApiSpec } from "../openapi-spec";

const PID = "955a00dc-0a1c-40ea-907e-af983697f5a3";

describe("embed preview rules", () => {
  it("accepts https origins and localhost http only", () => {
    expect(normalizeEmbedOrigin("https://dashboard.acme.com")).toBe("https://dashboard.acme.com");
    expect(normalizeEmbedOrigin("https://dashboard.acme.com/")).toBe("https://dashboard.acme.com");
    expect(normalizeEmbedOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeEmbedOrigin("http://acme.com")).toBeNull();
    expect(normalizeEmbedOrigin("https://*.acme.com")).toBeNull();
    expect(normalizeEmbedOrigin("https://acme.com/app")).toBeNull();
    expect(normalizeEmbedOrigin("https://u:p@acme.com")).toBeNull();
    expect(normalizeEmbedOrigin("javascript:alert(1)")).toBeNull();
  });

  it("names only the allowed origin in the framing policy", () => {
    expect(frameAncestorsCsp("https://dashboard.acme.com")).toBe("frame-ancestors 'self' https://dashboard.acme.com;");
  });

  it("maps a project to one stable preview address and back", () => {
    const host = previewHost(PID);
    expect(host).toBe("preview--955a00dc0a1c40ea907eaf983697f5a3.sites.custardai.dev");
    expect(host.split(".")[0].length).toBeLessThanOrEqual(63);
    expect(projectIdFromPreviewSlug(host.split(".")[0])).toBe(PID);
    expect(projectIdFromPreviewSlug("amaraglow")).toBeNull();
    expect(projectIdFromPreviewSlug("preview--xyz")).toBeNull();
  });

  it("tokens are 24 lowercase alphanumerics and distinct", () => {
    const t = new Set(Array.from({ length: 50 }, newEmbedToken));
    expect(t.size).toBe(50);
    for (const x of t) expect(isEmbedToken(x)).toBe(true);
    expect(isEmbedToken("short")).toBe(false);
    expect(isEmbedToken(null)).toBe(false);
  });

  it("embed URL carries the token on the preview address", () => {
    expect(embedUrl(PID, "a".repeat(24))).toBe(
      `https://preview--955a00dc0a1c40ea907eaf983697f5a3.sites.custardai.dev/?petal_embed=${"a".repeat(24)}`,
    );
  });
});

describe("openapi spec", () => {
  it("is branded Custard AI and lists the real endpoints", () => {
    const spec = openApiSpec("https://example.test");
    expect(spec.info.title).toBe("Custard AI App Generation API");
    expect(spec.servers[0].url).toBe("https://example.test/api/public/v1");
    for (const p of ["/projects", "/generate", "/turns/{id}", "/projects/{id}/embed-preview", "/projects/{id}/publish", "/keys"]) {
      expect(Object.keys(spec.paths)).toContain(p);
    }
  });
});
