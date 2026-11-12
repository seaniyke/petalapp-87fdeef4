import { describe, expect, it } from "vitest";
import { detectIntents, isNegatedAt } from "@/lib/intent-registry";
import { sharedBackendKit } from "@/server/shared-backend-kit";
import { deriveIntentContract } from "@/server/prd/intent-contract";
import { resolveIntentActions } from "@/server/intent-actions.server";
import { extractRequestedPages } from "@/server/requested-scope";
import { unguardedAppRoutes } from "@/server/engine/route-paths";

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
  it("'My recipes' stays its own page next to 'Recipes'", () => {
    const t = "Pages:\n- Home: hero and a call to join.\n- Recipes: all recipes.\n- My recipes: your own recipes.";
    expect(extractRequestedPages(t)).toEqual(["home", "recipes", "my recipes"]);
  });
});

describe("a website with sign-up keeps its public pages public", () => {
  const RECIPES =
    'Build "Hearth & Herb", a recipe sharing website where home cooks sign up and share their recipes.\n' +
    "Pages:\n- Home: newest recipes.\n- Recipes: every recipe.\n- Sign in: sign up and sign in.\n- My recipes: for signed-in cooks only.";
  const router = `import { Routes, Route } from "@/components/ui/router";
import { RequireAuth } from "@/integrations/backend/auth";
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<SignIn />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/recipes" element={<Recipes />} />
        <Route path="/my-recipes" element={<RequireAuth><MyRecipes /></RequireAuth>} />
      </Route>
    </Routes>
  );
}`;
  it("is a public site with a members area, not an app behind a wall", () => {
    expect(deriveIntentContract(RECIPES, null).surface).toBe("public+app");
  });
  it("the sign-in check does not demand that Home and Recipes be locked", () => {
    expect(unguardedAppRoutes(router, [], "public+app")).toEqual([]);
  });
  it("an app-only product still has every page locked", () => {
    expect(unguardedAppRoutes(router, [], "app")).toEqual(["/", "/recipes"]);
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

describe("a shop's checkout delivery details do not make it a logistics system", () => {
  const SHOP =
    "Build a phone shopping app for hair: wigs and bundles. Cart with subtotal, delivery fee and total, " +
    "and a checkout screen with delivery address. No sign-in needed.";
  it("stays an online store and asks for no accounts", () => {
    const c = deriveIntentContract(SHOP, null);
    expect(c.archetype).toBe("commerce");
    expect(c.surface ?? null).toBeNull();
  });
  it("a real courier dispatch app is still delivery", () => {
    expect(deriveIntentContract("Build a delivery management app where admins assign drivers to parcels", null).archetype).toBe("delivery");
  });
});
