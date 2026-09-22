import { describe, expect, it } from "vitest";
import {
  detectSurfaceIntent,
  renderSurfaceBlock,
  renderSurfaceMap,
  SURFACES,
} from "@/lib/kimble-surfaces";

describe("detectSurfaceIntent", () => {
  const cases: Array<[string, string]> = [
    ["I want to connect kimble.cloud to this app", "domains"],
    ["can you add a custom domain?", "domains"],
    ["how many credits do I have left?", "credits"],
    ["I want to top up", "credits"],
    ["show me my invoices", "credits"],
    ["who signed up to my app?", "cloud.users"],
    ["show me my app's users", "cloud.users"],
    ["can I see the database?", "cloud.database"],
    ["where are the uploaded files?", "cloud.storage"],
    ["where do I add an API key?", "cloud.secrets"],
    ["show me the server logs", "cloud.logs"],
    ["how much AI usage have I had?", "cloud.ai"],
    ["open cloud", "cloud"],
    ["can you publish it?", "publish"],
    ["I want to take payments with Paystack", "payments"],
    ["can you connect Resend?", "integrations"],
    ["how many visitors do I have?", "analytics"],
    ["I want to change the social preview", "website-info"],
    ["can I download the android build?", "mobile"],
    ["I want to revert to yesterday's version", "history"],
    ["show me the code", "code"],
    ["can you give me a share link?", "share"],
    ["I want a security review", "security"],
    ["open project settings", "settings"],
  ];

  for (const [text, id] of cases) {
    it(`reads "${text}" as ${id}`, () => {
      expect(detectSurfaceIntent(text)?.surface.id).toBe(id);
    });
  }

  const silent = [
    "build me a marketplace where people buy domains",
    "make an app that takes payments from customers",
    "create a dashboard page",
    "add a landing page with a hero and pricing",
    "a site where users can upload files",
    "hi",
    "",
    "make it blue",
  ];

  for (const text of silent) {
    it(`stays out of the way for "${text}"`, () => {
      expect(detectSurfaceIntent(text)).toBeNull();
    });
  }

  it("returns the phrase that matched", () => {
    expect(detectSurfaceIntent("I want a custom domain")?.matched).toMatch(/domain/i);
  });
});

describe("prompt blocks", () => {
  it("is empty when nothing was detected", () => {
    expect(renderSurfaceBlock(null)).toBe("");
  });

  it("names the area and forbids third-person framing", () => {
    const block = renderSurfaceBlock(detectSurfaceIntent("I want a custom domain"));
    expect(block).toContain("domains");
    expect(block).toContain("opening on their screen");
  });

  it("flags the areas that need the user's own money or account", () => {
    const block = renderSurfaceBlock(detectSurfaceIntent("I want to top up"));
    expect(block).toMatch(/their own money|their own account/);
    const noMoney = renderSurfaceBlock(detectSurfaceIntent("show me the code"));
    expect(noMoney).not.toMatch(/their own money/);
  });

  it("lists every top-level area in the self-knowledge map", () => {
    const map = renderSurfaceMap();
    for (const s of SURFACES) {
      if (s.id.startsWith("cloud.")) continue;
      expect(map).toContain(s.label);
    }
  });
});
