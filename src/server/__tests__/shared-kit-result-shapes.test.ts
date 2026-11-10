import { describe, expect, it, vi, beforeAll } from "vitest";
import ts from "typescript";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sharedBackendKit } from "../shared-backend-kit";

/**
 * Allure Bar's shop showed "Cannot read properties of undefined (reading 'map')":
 * the AI read `seedOnce(...).records` and passed `create(...)` straight into a
 * record mapper. The generated client must accept both reading styles.
 */
type Rec = { id: string; data: { name: string }; created_at: string; updated_at: string };
let db: {
  list: (c: string, o?: { mine?: boolean; everyone?: boolean }) => Promise<Rec[] & { records: Rec[] }>;
  create: (c: string, d: unknown) => Promise<Rec & { record: Rec }>;
  update: (c: string, id: string, d: unknown) => Promise<Rec & { record: Rec }>;
  seedOnce: (c: string, rows: unknown[]) => Promise<Rec[] & { records: Rec[] }>;
};
const store: Rec[] = [];
const listUrls: string[] = [];

beforeAll(async () => {
  const client = sharedBackendKit({
    baseUrl: "https://petalapp.lovable.app",
    projectId: "p1",
    apiKey: "key-12345678",
  } as never).find((f) => f.path.endsWith("client.ts"))!.content;
  const js = ts.transpileModule(client, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), "kit-"));
  const file = join(dir, "client.mjs");
  writeFileSync(file, js);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST" && url.includes("/_seed")) {
      const rows = JSON.parse(String(init!.body)).rows as Record<string, unknown>[];
      for (const data of rows) {
        store.push({ id: "r" + (store.length + 1), data, created_at: "2026-11-07", updated_at: "2026-11-07" } as Rec);
      }
      return new Response(JSON.stringify({ seeded: true, count: rows.length }), { status: 201 });
    }
    if (method === "POST") {
      const rec: Rec = {
        id: "r" + (store.length + 1),
        data: JSON.parse(String(init!.body)),
        created_at: "2026-11-07",
        updated_at: "2026-11-07",
      };
      store.push(rec);
      return new Response(JSON.stringify({ record: rec }), { status: 201 });
    }
    if (method === "PATCH") {
      const rec = { ...store[0]!, data: { ...store[0]!.data, ...JSON.parse(String(init!.body)) } };
      return new Response(JSON.stringify({ record: rec }), { status: 200 });
    }
    listUrls.push(url);
    const limit = Number(new URL(url).searchParams.get("limit") || 0);
    return new Response(JSON.stringify({ records: limit ? store.slice(0, limit) : store }), { status: 200 });
  });
  db = (await import(/* @vite-ignore */ pathToFileURL(file).href)).db;
});

describe("generated data helper result shapes", () => {
  it("seedOnce results work as an array and as { records }", async () => {
    const res = await db.seedOnce("products", [{ name: "Dew Cheek Tint" }, { name: "Silk Lip Oil" }]);
    expect(res.map((r) => r.data.name)).toEqual(["Dew Cheek Tint", "Silk Lip Oil"]);
    expect(res.records.map((r) => r.data.name)).toEqual(["Dew Cheek Tint", "Silk Lip Oil"]);
  });

  it("list results work as an array and as { records }", async () => {
    const res = await db.list("products");
    expect(res.length).toBe(2);
    expect(res.records.length).toBe(2);
  });

  it("create results work directly and as { record }", async () => {
    const res = await db.create("products", { name: "Velvet Brow Balm" });
    expect(res.data.name).toBe("Velvet Brow Balm");
    expect(res.record.data.name).toBe("Velvet Brow Balm");
    expect(res.id).toBe(res.record.id);
  });

  it("update results work directly and as { record }", async () => {
    const res = await db.update("products", "r1", { name: "Dew Cheek Tint — Rose" });
    expect(res.data.name).toBe("Dew Cheek Tint — Rose");
    expect(res.record.data.name).toBe("Dew Cheek Tint — Rose");
  });
});

describe("who a list shows", () => {
  it("everyone: true asks for every user's rows (public content like shared recipes)", async () => {
    await db.list("recipes", { everyone: true });
    expect(new URL(listUrls.at(-1)!).searchParams.get("scope")).toBe("all");
  });
  it("a plain list never asks for other users' rows", async () => {
    await db.list("orders");
    expect(new URL(listUrls.at(-1)!).searchParams.get("scope")).toBeNull();
  });
  it("mine: true wins over everyone", async () => {
    await db.list("recipes", { mine: true, everyone: true });
    const q = new URL(listUrls.at(-1)!).searchParams;
    expect(q.get("mine")).toBe("1");
    expect(q.get("scope")).toBeNull();
  });
});
