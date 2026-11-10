import { describe, expect, it } from "vitest";
import { detectIntents, isNegatedAt } from "@/lib/intent-registry";
import { sharedBackendKitFiles } from "@/server/shared-backend-kit";

const MIRA =
  "Build a website for a beauty shop called Mira Beauty. Main action: book appointments and buy products online. " +
  "Include an Add to Cart + Checkout flow.\n" +
  "No customer accounts, sign-in or database: the AI staff in the chat handle bookings, orders and questions.";

describe("explicit 'no database' wins over keyword guesses", () => {
  it("the Mira Beauty brief does not ask for a backend", () => {
    expect(detectIntents(MIRA, null)).not.toContain("backend");
  });
  it("a plain request for a database still does", () => {
    expect(detectIntents("Build a task app with a database and sign-in for each user", null)).toContain("backend");
  });
  it("a 'no' in another clause does not cancel a real request", () => {
    const t = "No dark mode please. Add sign-in so members can log in.";
    expect(detectIntents(t, null)).toContain("backend");
    expect(isNegatedAt(t, t.indexOf("sign-in"))).toBe(false);
  });
});

describe("starter rows are written all-or-nothing", () => {
  it("the shipped client seeds through one batch request, never a per-row loop", () => {
    const files = sharedBackendKitFiles({ projectId: "p", apiKey: "k", baseUrl: "https://x.dev" });
    const client = files.find((f) => f.path.endsWith("client.ts"))!.content;
    expect(client).toContain("/_seed");
    expect(client).not.toContain("catch { break; }");
  });
});
