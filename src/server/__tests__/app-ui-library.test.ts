import { describe, it, expect } from "vitest";
import { renderAppUiBlock, renderAppScreenChecklistBlock, APP_UI_VARIANTS } from "../app-ui-library.server";
import { extractAppSpec, renderAppSpecBlock } from "../app-spec.server";

describe("app-ui library", () => {
  it("covers every product surface", () => {
    const surfaces = new Set(APP_UI_VARIANTS.map((v) => v.surface));
    for (const s of ["shell", "data-table", "filters", "detail", "form", "metrics", "state", "settings", "activity"]) {
      expect(surfaces.has(s as never)).toBe(true);
    }
  });

  it("locks a palette and font pair deterministically", () => {
    const a = renderAppUiBlock("a CRM for a logistics team");
    const b = renderAppUiBlock("a CRM for a logistics team");
    expect(a.pick.palette.id).toBe(b.pick.palette.id);
    expect(a.text).toContain("LOCKED design tokens");
    expect(a.text).toContain(a.pick.fontPair.display);
  });

  it("bans the four-KPI-card cliché", () => {
    expect(renderAppUiBlock("inventory tool").text).toMatch(/4 identical KPI cards/);
  });

  it("requires the full screen set", () => {
    const c = renderAppScreenChecklistBlock();
    expect(c).toMatch(/Empty \/ loading \/ error/);
    expect(c).toMatch(/Seeded demo data/);
  });
});

describe("app spec extraction", () => {
  it("pulls entities, roles and workflows out of a complex brief", () => {
    const spec = extractAppSpec("An ERP for a bakery: inventory, suppliers, orders, staff shifts, with manager approval and CSV export");
    expect(spec.entities).toEqual(expect.arrayContaining(["InventoryItem", "Supplier", "Order", "Shift"]));
    expect(spec.roles).toContain("manager");
    expect(spec.workflows).toEqual(expect.arrayContaining(["approval flow", "import / export"]));
    expect(spec.relational).toBe(true);
  });

  it("flags money and reporting", () => {
    const spec = extractAppSpec("invoicing app with revenue analytics");
    expect(spec.monetary).toBe(true);
    expect(spec.reporting).toBe(true);
    expect(renderAppSpecBlock("invoicing app with revenue analytics")).toMatch(/integer minor units/);
  });

  it("stays silent on a plain landing brief", () => {
    expect(renderAppSpecBlock("a landing page for my band")).toBe("");
  });
});
