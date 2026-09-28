import { describe, it, expect } from "vitest";
import { deriveIntentContract } from "../prd/intent-contract";

const routes = (t: string) => deriveIntentContract(t).pages.map((p) => p.route);

describe("booking / appointments family", () => {
  it("salon booking → booking family, no /menu", () => {
    const c = deriveIntentContract("Build me a booking system for my hair salon. Customers should see services and prices, create an account, book an appointment with a stylist, and view their bookings. I need to see all bookings and manage services.");
    expect(c.archetype).toBe("booking");
    expect(c.surface).toBe("public+app");
    expect(routes(c.label ? "Build me a booking system for my hair salon with customer accounts" : "")).toEqual(["/", "/login", "/dashboard", "/services", "/bookings", "/settings"]);
    expect(c.pages.map((p) => p.route)).not.toContain("/menu");
  });
  it("barber → booking", () => {
    expect(deriveIntentContract("An app for my barbershop where clients book appointments").archetype).toBe("booking");
  });
  it("tutor lessons → booking", () => {
    expect(deriveIntentContract("A platform where students book tutoring lessons with a tutor").archetype).toBe("booking");
  });
  it("restaurant stays restaurant", () => {
    const c = deriveIntentContract("Build a restaurant management system with table reservations");
    expect(c.archetype).toBe("restaurant");
    expect(c.pages.map((p) => p.route)).toContain("/menu");
  });
  it("delivery stays delivery", () => {
    expect(deriveIntentContract("Build a delivery management platform where customers place orders and drivers manage deliveries").archetype).toBe("delivery");
  });
  it("hospital/clinic stays healthcare", () => {
    expect(deriveIntentContract("Build me a hospital management system").archetype).toBe("healthcare");
    expect(deriveIntentContract("A clinic app to book appointments").archetype).toBe("healthcare");
  });
  it("generic website → not booking", () => {
    const c = deriveIntentContract("A portfolio website for a photographer");
    expect(c.archetype).not.toBe("booking");
    expect(c.pages).toEqual([]);
  });
  it("salon marketing website stays a website", () => {
    const c = deriveIntentContract("A website for my hair salon");
    expect(c.pages).toEqual([]);
  });
});
