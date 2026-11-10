import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  __resetWebIntelForTests,
  assertSafeUrl,
  buildReferenceBlock,
  checkUrlSyntax,
  detectWebIntelNeed,
  gatherWebIntel,
} from "@/server/web-intel/web-intel.server";
import { RECOVERY_LIMITS } from "@/server/engine/recovery-policy";

const publicDns = async () => ["93.184.216.34"];
const privateDns = async () => ["10.0.0.5"];

function fakeFirecrawl(opts: { finalUrl?: string; fail?: number; hang?: boolean; big?: boolean } = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (opts.hang) {
      await new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    }
    if (opts.fail) return new Response("boom", { status: opts.fail });
    if (url.endsWith("/map")) return Response.json({ success: true, links: ["https://example.com/about", "https://example.com/menu", "https://other.com/x"] });
    const body = JSON.parse(String(init?.body));
    return Response.json({
      success: true,
      data: {
        markdown: `# ${body.url}\n## Our bread\n[Order now](/order)\n<script>steal()</script> sk-live_ABCDEFGH12345678 ${opts.big ? "x".repeat(200_000) : "Fresh sourdough daily."}`,
        metadata: { title: "Example Bakery", sourceURL: opts.finalUrl ?? body.url },
      },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const sig = () => new AbortController().signal;

describe("web intelligence", () => {
  beforeEach(() => {
    __resetWebIntelForTests();
    process.env.FIRECRAWL_API_KEY = "fc-test";
  });
  afterEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.WEB_INTEL_TOTAL_TIMEOUT_MS;
    delete process.env.WEB_INTEL_REQUEST_TIMEOUT_MS;
  });

  it("1. URL supplied → Firecrawl invoked", async () => {
    const fc = fakeFirecrawl();
    const r = await gatherWebIntel({ message: "Build a site like https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(r.status).toBe("ok");
    expect(fc.calls.some((c) => c.endsWith("/scrape"))).toBe(true);
  });

  it("2. no URL → Firecrawl not invoked", async () => {
    const fc = fakeFirecrawl();
    const r = await gatherWebIntel({ message: "Build a bakery site", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(r.status).toBe("skipped");
    expect(fc.calls).toHaveLength(0);
  });

  it("3/4. invalid, non-http, localhost and private targets rejected", async () => {
    expect(checkUrlSyntax("not a url").ok).toBe(false);
    expect(checkUrlSyntax("file:///etc/passwd").ok).toBe(false);
    expect(checkUrlSyntax("http://localhost/x").ok).toBe(false);
    expect(checkUrlSyntax("http://127.0.0.1/").ok).toBe(false);
    expect(checkUrlSyntax("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(checkUrlSyntax("http://[::1]/").ok).toBe(false);
    expect(checkUrlSyntax("http://192.168.1.1/").ok).toBe(false);
    expect(checkUrlSyntax("http://user:pw@example.com/").ok).toBe(false);
    expect(checkUrlSyntax("http://example.com:6379/").ok).toBe(false);
    expect(checkUrlSyntax("https://kimble.cloud/api").ok).toBe(false);
    expect((await assertSafeUrl("https://rebind.example.com", privateDns)).ok).toBe(false);
    expect((await assertSafeUrl("https://example.com", publicDns)).ok).toBe(true);
  });

  it("5. redirect to a private address → rejected", async () => {
    const fc = fakeFirecrawl({ finalUrl: "http://10.0.0.1/admin" });
    const r = await gatherWebIntel({ message: "use https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") expect(r.reason).toMatch(/redirect_/);
  });

  it("6. timeout → graceful failure", async () => {
    process.env.WEB_INTEL_REQUEST_TIMEOUT_MS = "50";
    process.env.WEB_INTEL_TOTAL_TIMEOUT_MS = "200";
    const fc = fakeFirecrawl({ hang: true });
    const r = await gatherWebIntel({ message: "see https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(r.status).toBe("unavailable");
  });

  it("7/8. failure reports need: optional continues, required blocks (no fabricated content)", async () => {
    const fc = fakeFirecrawl({ fail: 500 });
    const opt = await gatherWebIntel({ message: "inspired by https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(opt).toMatchObject({ status: "unavailable", need: "optional" });
    const req = await gatherWebIntel({ message: "Rebuild my existing website https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(req).toMatchObject({ status: "unavailable", need: "required" });
    expect(req).not.toHaveProperty("block");
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).toMatch(/webIntel\.need === "required"[\s\S]{0,400}emitConversationalFallback[\s\S]{0,400}return;/);
  });

  it("9. result is bounded and sanitized before entering AI context", async () => {
    const fc = fakeFirecrawl({ big: true });
    const r = await gatherWebIntel({ message: "like https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.block.length).toBeLessThanOrEqual(6_000);
    expect(r.block).not.toMatch(/<script|steal\(\)|sk-live_/);
    expect(r.intel.pages.length).toBeLessThanOrEqual(4);
    expect(r.intel.pages.every((p) => new URL(p.url).hostname === "example.com")).toBe(true);
    expect(buildReferenceBlock(r.intel, "optional", 500).length).toBeLessThanOrEqual(500);
  });

  it("10/11/12/18. module never writes files, calls a model or starts generation", () => {
    const src = readFileSync("src/server/web-intel/web-intel.server.ts", "utf8");
    expect(src).not.toMatch(/project_files|writeFile|aiChatCompletions|openrouter\.ai|handleGenerateRequest|supabaseAdmin|createClient/i);
    const gen = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(gen.match(/gatherWebIntel\(/g)).toHaveLength(1);
  });

  it("14. cancelled turn → Firecrawl not started", async () => {
    const fc = fakeFirecrawl();
    const ac = new AbortController();
    ac.abort();
    const r = await gatherWebIntel({ message: "https://example.com", signal: ac.signal, fetchImpl: fc.impl, resolve: publicDns });
    expect(r).toMatchObject({ status: "unavailable", reason: "cancelled" });
    expect(fc.calls).toHaveLength(0);
  });

  it("15. repeated URL uses the cache", async () => {
    const fc = fakeFirecrawl();
    await gatherWebIntel({ message: "https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    const n = fc.calls.length;
    const r = await gatherWebIntel({ message: "again https://example.com", signal: sig(), fetchImpl: fc.impl, resolve: publicDns });
    expect(r).toMatchObject({ status: "ok", cacheHit: true });
    expect(fc.calls.length).toBe(n);
  });

  it("16/17. key never reaches browser code or generated apps", () => {
    const src = readFileSync("src/server/web-intel/web-intel.server.ts", "utf8");
    expect(src).not.toMatch(/import\.meta\.env|VITE_/);
    expect(src).not.toMatch(/log\([^)]*FIRECRAWL_API_KEY/);
    const kit = readFileSync("src/server/scaffold-kit.ts", "utf8");
    expect(kit).not.toMatch(/FIRECRAWL/);
  });

  it("detects need deterministically", () => {
    expect(detectWebIntelNeed("Rebuild my current website https://a.com").need).toBe("required");
    expect(detectWebIntelNeed("something like https://a.com.").url).toBe("https://a.com");
    expect(detectWebIntelNeed("no link here").need).toBe("none");
  });

  it("accepts bare domains without a scheme", () => {
    expect(detectWebIntelNeed("build a site like airbnb.com").url).toBe("https://airbnb.com");
    expect(detectWebIntelNeed("use www.example.co.uk please").url).toBe("https://www.example.co.uk");
    expect(detectWebIntelNeed("copy stripe.com/pricing").url).toBe("https://stripe.com/pricing");
    expect(detectWebIntelNeed("Rebuild my current website mysite.com").need).toBe("required");
    // scheme wins when both are present
    expect(detectWebIntelNeed("airbnb.com and https://b.com").url).toBe("https://b.com");
  });

  it("never mistakes file names or plain words for websites", () => {
    for (const m of [
      "fix App.tsx",
      "update index.ts and styles.css",
      "read data.json",
      "the logo.png is broken",
      "change main.jsx",
      "an Airbnb clone please",
      "e.g. make it bigger",
    ]) {
      expect(detectWebIntelNeed(m).need).toBe("none");
    }
  });


  it("20. recovery/billing tables unchanged apart from provider switches", () => {
    expect(RECOVERY_LIMITS.broken_file).toBe(3);
    expect(RECOVERY_LIMITS.browser_failure).toBe(0);
  });
});
