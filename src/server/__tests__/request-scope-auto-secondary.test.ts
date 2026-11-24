import { describe, expect, it } from "vitest";
import { applyIntentContract, deriveIntentContract, divergentPages } from "@/server/prd/intent-contract";
import { deterministicPrd } from "@/server/prd/prd-deterministic";
import { nextRoutineWork, routinePageWork } from "@/server/engine/secondary-work";
import { runToolLoop, type ModelReply, type ToolCallMsg } from "@/server/engine/tool-loop";
import { reconcileResumedPlan } from "@/server/engine/plan";

describe("request authority across domains", () => {
  it.each([
    ["internal hotel inventory app", "Reservations, Guests, Rooms, Inventory", ["/", "/reservations", "/guests", "/rooms", "/inventory"]],
    ["internal music school app with a restaurant cafeteria", "Students, Classes, Cafeteria", ["/", "/students", "/classes", "/cafeteria"]],
    ["internal event logistics app", "Events, Tickets, Check-in", ["/", "/events", "/tickets", "/check-in"]],
    ["internal real estate CRM app", "Properties, Viewings, Contacts", ["/", "/properties", "/viewings", "/contacts"]],
  ])("%s requires only named pages and its home", (product, names, expected) => {
    const c = deriveIntentContract(`Build an ${product}. Pages: ${names}.`);
    expect(c.pages.map((p) => p.route)).toEqual(expected);
    expect(c.suggestions).toBeUndefined();
  });
  it("vague domains keep suggestions but never force their pages", () => {
    const c = deriveIntentContract("Build an internal warehouse inventory app");
    expect(c.pages.map((p) => p.route)).toEqual(["/"]);
    expect(c.suggestions?.pages.map((p) => p.route)).toContain("/purchase-orders");
    expect(c.entities).toEqual([]);
    expect(c.workflows).toEqual([]);
  });
  it("an exclusion list cannot select a commerce or booking family", () => {
    const c = deriveIntentContract("Build a photography website. Pages: Home, About. No booking, accounts, shop or checkout.");
    expect(c.commerceRequested).toBe(false);
    expect(c.pages.map((p) => p.route)).toEqual(["/", "/about"]);
    expect(c.surface).toBe("public");
  });
  it("named cross-domain workflows remain allowed", () => {
    const brief = "Build an internal clinic app. Pages: Patients, Stock, Cafeteria, Deliveries.";
    expect(divergentPages(deriveIntentContract(brief), ["/stock", "/cafeteria", "/deliveries", "/products"], brief)).toEqual([]);
  });
  it("explicitly requested commerce is not restricted", () => {
    const brief = "Build a school app with an online shop, cart and checkout. Pages: Students, Shop, Cart, Checkout.";
    expect(divergentPages(deriveIntentContract(brief), ["/shop", "/cart", "/checkout"], brief)).toEqual([]);
  });
  it("PRD enrichment does not append suppliers, purchases, movements or settings", () => {
    const brief = "Build an internal hotel inventory app. Pages: Reservations, Guests, Rooms, Inventory.";
    const original = deterministicPrd(brief);
    const updated = applyIntentContract(original, brief);
    const ids = updated.requirements?.map((r) => r.id) ?? [];
    for (const unwanted of ["suppliers", "purchase-orders", "stock-movements", "settings"]) expect(ids).not.toContain(unwanted);
    expect(updated.intent?.pages.map((p) => p.route)).toEqual(["/", "/reservations", "/guests", "/rooms", "/inventory"]);
    expect(updated.dataModel).toEqual(original.dataModel);
  });
  it("resuming cannot restore an obsolete template-expanded plan", () => {
    const current = [{ route: "/", file: "src/pages/Home.tsx" }, { route: "/guests", file: "src/pages/Guests.tsx" }];
    const saved = [{ route: "/guests", file: "src/pages/GuestList.tsx" }, { route: "/purchase-orders", file: "src/pages/PurchaseOrders.tsx" }];
    expect(reconcileResumedPlan(current, saved)).toEqual([current[0], saved[0]]);
  });
});

const pages = [
  { route: "/", file: "src/pages/Home.tsx" },
  { route: "/about", file: "src/pages/About.tsx" },
  { route: "/faq", file: "src/pages/Faq.tsx" },
];
const layout = { path: "src/components/Layout.tsx", content: "export default function Layout(){return <main/>;}" };
const pageContent = "export default function Page(){return <main>Complete page</main>;}";
let id = 0;
const tool = (name: string, args: object): ToolCallMsg => ({ id: `auto${id++}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const response = (...toolCalls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls, usage: { promptTokens: 100, cachedTokens: 0, completionTokens: 100, costUsd: 0.02 } });

describe("automatic proof-led cost routing", () => {
  it("admits an explicitly read-only list", () => {
    expect(routinePageWork({ route: "/guests", file: "src/pages/Guests.tsx" }, "Pages:\n- Guests: read-only table of guests")?.kind).toBe("read_only_list");
  });
  it("keeps quantity updates and other complex features on frontier", () => {
    expect(routinePageWork({ route: "/inventory", file: "src/pages/Inventory.tsx" }, "Pages:\n- Inventory: stock list and update quantity")).toBeNull();
    expect(routinePageWork(pages[1] ?? pages[0] ?? { route: "/", file: "" }, "The About page must submit a payment form.")).toBeNull();
  });
  it("does not route stale shared proof", () => {
    const files = new Map([[layout.path, "changed"]]);
    expect(nextRoutineWork(pages, "Home and About", { pages, files, validation: new Map([[layout.path, []]]), validatedHash: new Map([[layout.path, layout.content]]), hash: (s) => s }, new Set())).toBeNull();
  });
  it("forces fast writing even when frontier tries to write all pages without delegating", async () => {
    const models: string[] = [];
    let frontier = 0;
    const result = await runToolLoop({
      goal: "Build a website. Pages: Home, About, FAQ.", system: "Build the complete request", brief: "Home, About, FAQ", files: [], secondaryPages: pages,
      validate: () => [],
      readiness: (tree) => ({ ready: pages.every((p) => tree.some((f) => f.path === p.file)), findings: [] }),
      callModel: async (_, __, ___, context) => {
        models.push(context?.secondary ? `fast:${context.secondary.path}` : "frontier");
        if (context?.secondary) return response(tool("create_file", { path: context.secondary.path, content: pageContent }));
        if (frontier++ === 0) return response(tool("create_file", layout), ...pages.map((p) => tool("create_file", { path: p.file, content: pageContent })), tool("finish", {}));
        return response(tool("finish", {}));
      },
    });
    expect(result.outcome).toBe("finished");
    expect(models).toEqual(["frontier", "fast:src/pages/About.tsx", "frontier", "fast:src/pages/Faq.tsx", "frontier"]);
    expect(result.traces[0]?.writtenPaths).toEqual([layout.path, "src/pages/Home.tsx"]);
    expect(result.traces[1]?.writtenPaths).toEqual(["src/pages/About.tsx"]);
    expect(result.state.spentUsd).toBeCloseTo(0.10);
  });
  it.each(["broken", "no-write", "shared-write"])("returns %s fast work to frontier without losing the page", async (failure) => {
    const selected: string[] = [];
    let frontier = 0;
    const result = await runToolLoop({
      goal: "Pages: Home, About.", system: "Build all requested functionality", brief: "Home and About", files: [], secondaryPages: pages.slice(0, 2),
      validate: (f) => f.content === "BROKEN" ? ["invalid source"] : [],
      readiness: (tree) => ({ ready: tree.some((f) => f.path === "src/pages/About.tsx" && f.content === pageContent), findings: [] }),
      callModel: async (_, __, ___, context) => {
        selected.push(context?.secondary ? "fast" : "frontier");
        if (context?.secondary) return failure === "no-write" ? response() : response(tool("create_file", { path: failure === "shared-write" ? layout.path : context.secondary.path, content: "BROKEN" }));
        if (frontier++ === 0) return response(tool("create_file", layout));
        return response(tool("create_file", { path: "src/pages/About.tsx", content: pageContent }), tool("finish", {}));
      },
    });
    expect(selected).toEqual(["frontier", "fast", "frontier"]);
    expect(result.outcome).toBe("finished");
    expect(result.files.find((f) => f.path === layout.path)?.content).toBe(layout.content);
    expect(result.files.find((f) => f.path === "src/pages/About.tsx")?.content).toBe(pageContent);
  });
  it("no shared proof falls back to frontier, never a blocked capability", async () => {
    const selected: string[] = [];
    let count = 0;
    const result = await runToolLoop({
      goal: "Pages: Home, About.", system: "Complete the site", brief: "Home and About", files: [], secondaryPages: pages.slice(0, 2),
      validate: () => [], readiness: (tree) => ({ ready: tree.some((f) => f.path === "src/pages/About.tsx"), findings: [] }),
      callModel: async (_, __, ___, context) => {
        selected.push(context?.secondary ? "fast" : "frontier");
        return count++ === 0 ? response(tool("create_file", { path: "src/pages/About.tsx", content: pageContent }), tool("finish", {})) : response(tool("create_file", { path: "src/pages/About.tsx", content: pageContent }), tool("finish", {}));
      },
    });
    expect(result.outcome).toBe("finished");
    expect(selected).toEqual(["frontier", "frontier"]);
  });
});