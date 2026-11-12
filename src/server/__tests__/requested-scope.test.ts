import { describe, it, expect } from "vitest";
import {
  extractRequestedPages,
  narrowRoutesToRequest,
  buildGenerationUnits,
} from "@/server/requested-scope";

const RESTAURANT = ["/", "/menu", "/reservations", "/story", "/contact"];

describe("requested scope is authoritative", () => {
  it("reads an explicit page list", () => {
    expect(
      extractRequestedPages("Build Rise & Crumb, a bakery site with Home, Menu, About, Contact pages."),
    ).toEqual(["home", "menu", "about", "contact"]);
  });

  it("sections listed in brackets after a page are not pages (Aura live run)", () => {
    const prompt =
      "Build a website for Aura, an architectural lighting design studio. Pages: Home (hero, philosophy, featured projects, testimonials, consultation call to action), Services, Projects (portfolio with category filter), Contact (inquiry form and studio details). Website only, no accounts.";
    expect(extractRequestedPages(prompt)).toEqual(["home", "services", "projects", "contact"]);
  });

  it("still reads a page list written inside brackets", () => {
    expect(extractRequestedPages("A café site with pages (Home, Menu, Contact).")).toEqual([
      "home",
      "menu",
      "contact",
    ]);
  });

  it("a bakery with four named pages never gets /reservations", () => {
    const r = narrowRoutesToRequest(
      "A premium bakery website: Home, Menu, About, Contact pages",
      RESTAURANT,
      { marketing: true },
    );
    expect(r).toEqual(["/", "/menu", "/about", "/contact"]);
    expect(r).not.toContain("/reservations");
  });

  it("a bakery homepage is one page", () => {
    expect(narrowRoutesToRequest("Build a bakery homepage", RESTAURANT)).toEqual(["/"]);
  });

  it("a marketing site with no page list gets no template pages", () => {
    expect(narrowRoutesToRequest("Build a website for my bakery", RESTAURANT, { marketing: true })).toEqual(["/"]);
  });

  it("apps without a page list keep their core screens", () => {
    const crm = ["/", "/contacts", "/deals"];
    expect(narrowRoutesToRequest("Build a CRM for my sales team", crm)).toEqual(crm);
  });
});

describe("bounded first-build generation units", () => {
  it("small builds stay one call", () => {
    const u = buildGenerationUnits("Home and Menu pages", []);
    expect(u.unitCount).toBe(1);
    expect(u.instruction).toBe("");
  });

  it("large builds split into the fewest parts", () => {
    const u = buildGenerationUnits("pages: Home, Menu, About, Contact, Blog, Careers, FAQ", []);
    expect(u.unitCount).toBe(3);
    expect(u.instruction).toMatch(/part 1 of 3/);
    expect(u.instruction).toMatch(/\/careers/);
  });
});

describe("a named page's colon lists its contents, not more pages", () => {
  it("'Product page: large photo, name, price' asks for no /large-photo or /name pages", () => {
    const pages = extractRequestedPages(
      "Screens:\n- Home: search and shelves.\n- Product page: large photo, name, price in Naira, rating, quantity, Add to cart.",
    );
    expect(pages).not.toContain("large photo");
    expect(pages).not.toContain("name");
    expect(pages).not.toContain("add to cart");
  });
  it("'pages: Home, Menu and Contact' still lists three pages", () => {
    expect(extractRequestedPages("Build a cafe site with pages: Home, Menu and Contact.")).toEqual(["home", "menu", "contact"]);
  });
});
