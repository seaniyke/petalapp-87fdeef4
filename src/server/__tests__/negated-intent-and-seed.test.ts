import { describe, expect, it } from "vitest";
import { detectIntents, isNegatedAt } from "@/lib/intent-registry";
import { sharedBackendKit } from "@/server/shared-backend-kit";
import { deriveIntentContract } from "@/server/prd/intent-contract";
import { resolveIntentActions } from "@/server/intent-actions.server";
import { extractRequestedPages } from "@/server/requested-scope";

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

const TIDEWATER =
  'Build a website for "Tidewater Coffee Roasters".\n\nPages:\n' +
  "- Home: a warm hero, our three signature coffees, a short story section, café hours, and a call to visit.\n" +
  "- Coffees: all eight of our coffees as cards.\n" +
  "- Café: what we serve in the café.\n" +
  "- About: our story.\n" +
  "- Contact: address and a simple message form that opens the visitor's email app.\n\n" +
  "This is a plain informational website. No database, no customer accounts and no sign-in.";

describe("'no database' is a veto on every path, not just keywords", () => {
  it("the visitor's email app does not turn a website into an application", () => {
    expect(deriveIntentContract(TIDEWATER, null).surface).toBe("public");
  });
  it("a real app request is still an app", () => {
    expect(deriveIntentContract("Build a calendar app for my team", null).surface).toBe("app");
  });
  it("the product planner cannot switch a database on after the user said no", async () => {
    const r = await resolveIntentActions({
      prompt: TIDEWATER,
      productNeedsBackend: { reason: "planner guess" },
      hasBackend: false,
      hasSharedBackend: false,
    });
    expect(r.enabledSharedBackend).toBe(false);
    expect(r.cloud.needed).toBe(false);
  });
});

describe("a bulleted page list names one page per bullet", () => {
  it("sections described on a page never become pages", () => {
    expect(extractRequestedPages(TIDEWATER)).toEqual(["home", "coffees", "cafe", "about", "contact"]);
  });
});

describe("starter rows are written all-or-nothing", () => {
  it("the shipped client seeds through one batch request, never a per-row loop", () => {
    const files = sharedBackendKit({ projectId: "p", apiKey: "k", baseUrl: "https://x.dev" });
    const client = files.find((f) => f.path.endsWith("client.ts"))!.content;
    expect(client).toContain("/_seed");
    expect(client).not.toContain("catch { break; }");
  });
});
