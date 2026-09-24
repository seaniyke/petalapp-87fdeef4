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
    const u = buildGenerationUnits("Home, Menu, About, Contact pages", []);
    expect(u.unitCount).toBe(1);
    expect(u.instruction).toBe("");
  });

  it("large builds split into the fewest parts", () => {
    const u = buildGenerationUnits("pages: Home, Menu, About, Contact, Blog, Careers, FAQ", []);
    expect(u.unitCount).toBe(2);
    expect(u.instruction).toMatch(/part 1 of 2/);
    expect(u.instruction).toMatch(/\/careers/);
  });
});
