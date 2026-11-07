import { describe, it, expect } from "vitest";
import { customerPrivacyIssues } from "@/server/verification/customer-privacy";
import { deriveRequirements } from "@/server/prd/prd-requirements";
import { COMPOSITION_RULES, STARTER_DATA_RULE } from "@/server/engine/first-build";

const f = (path: string, content: string) => ({ path, content });

// The real Allure Bar store module (7 Nov 2026), trimmed to its data calls.
const ALLURE_STORE = f(
  "src/lib/store-context.tsx",
  `const [p, b, o] = await Promise.all([
     db.seedOnce<ProductData>("products", INITIAL_PRODUCTS),
     db.seedOnce<BookingData>("bookings", INITIAL_BOOKINGS),
     db.list<OrderData>("orders", { limit: 25 }),
   ]);
   const saved = await db.create<BookingData>("bookings", payload);
   await db.update<BookingData>("bookings", id, merged);
   await db.remove("bookings", id);
   await db.create<ProductData>("products", input);`,
);

describe("customer page privacy", () => {
  it("flags every visitor seeing and changing other customers' bookings and orders", () => {
    const issues = customerPrivacyIssues(ALLURE_STORE, [ALLURE_STORE]);
    expect(issues.some((i) => i.includes('db.seedOnce("bookings")'))).toBe(true);
    expect(issues.some((i) => i.includes('db.list("orders")'))).toBe(true);
    expect(issues.some((i) => i.includes('db.update("bookings")'))).toBe(true);
    expect(issues.some((i) => i.includes('db.remove("bookings")'))).toBe(true);
  });

  it("flags visitors adding products to the store whatever the button is called", () => {
    const issues = customerPrivacyIssues(ALLURE_STORE, [ALLURE_STORE]);
    expect(issues.some((i) => i.includes('db.create("products")'))).toBe(true);
  });

  it("allows browsing the catalogue and creating a booking", () => {
    const ok = f(
      "src/pages/Shop.tsx",
      `const rows = await db.seedOnce("products", PRODUCTS); const t = await db.list("treatments");
       const saved = await db.create("bookings", form);`,
    );
    expect(customerPrivacyIssues(ok, [ok])).toEqual([]);
  });

  it("allows a signed-in visitor listing only their own bookings", () => {
    const mine = f("src/pages/MyBookings.tsx", `const rows = await db.list("bookings", { mine: true });`);
    expect(customerPrivacyIssues(mine, [mine])).toEqual([]);
  });

  it("leaves the signed-in staff area alone", () => {
    const staff = f("src/pages/dashboard/Bookings.tsx", `await db.list("bookings"); await db.create("products", x);`);
    expect(customerPrivacyIssues(staff, [staff])).toEqual([]);
  });

  it("with a signed-in area, judges public pages but not shared modules", () => {
    const app = f("src/App.tsx", `<Route path="/dashboard" element={<RequireAuth><Dash/></RequireAuth>} />`);
    const shared = f("src/lib/data.ts", `await db.list("bookings");`);
    const page = f("src/pages/Book.tsx", `await db.list("bookings");`);
    expect(customerPrivacyIssues(shared, [app, shared, page])).toEqual([]);
    expect(customerPrivacyIssues(page, [app, shared, page]).length).toBe(1);
  });
});

describe("look-and-feel words never become requirements", () => {
  it("the Allure Bar brief yields only real features", () => {
    const reqs = deriveRequirements(
      "Build a website for Allure Bar, a beauty bar: makeup, massage and beauty treatments, with an online store for makeup products and online bookings for treatments. The look should be modern, sleek, native, premium and natural. Keep the home page light on words.",
    );
    const labels = reqs.map((r) => r.description.toLowerCase());
    expect(labels.some((l) => /look should|native|natural|modern|light on words/.test(l))).toBe(false);
    expect(reqs.some((r) => r.id === "booking")).toBe(true);
    expect(reqs.some((r) => r.id === "catalog")).toBe(true);
  });
});

describe("shop and pop-up rules", () => {
  it("checkout stays out of the header, phone menu and footer", () => {
    expect(COMPOSITION_RULES).toMatch(/Checkout is never a link in the header, the phone menu or the footer/);
  });
  it("pop-ups use the kit Dialog or Sheet so Esc closes them", () => {
    expect(COMPOSITION_RULES).toMatch(/kit Dialog or Sheet, so it closes with Esc/);
  });
  it("visitors never see other people's bookings", () => {
    expect(STARTER_DATA_RULE).toMatch(/Visitors never see other people's bookings, orders or messages/);
  });
});
