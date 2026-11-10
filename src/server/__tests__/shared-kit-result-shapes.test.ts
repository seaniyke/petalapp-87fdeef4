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
  list: (c: string, o?: Record<string, unknown>) => Promise<Rec[] & { records: Rec[] }>;
  create: (c: string, d: unknown) => Promise<Rec & { record: Rec }>;
  update: (c: string, id: string, d: unknown) => Promise<Rec & { record: Rec }>;
  seedOnce: (c: string, rows: unknown[]) => Promise<Rec[] & { records: Rec[] }>;
};
const store: Rec[] = [];
const listUrls: string[] = [];
const authCalls: { url: string; body: Record<string, unknown> | null }[] = [];
const storage = new Map<string, string>();
const session = new Map<string, string>();
let replaced = "";
let assigned = "";
let authApi: {
  requestPasswordReset: (e: string, r?: string) => Promise<void>;
  updatePassword: (p: string) => Promise<unknown>;
  isRecovery: () => boolean;
  signInWithGoogle: (r?: string) => void;
  takeAuthError: () => string | null;
};
let getToken: () => string | null;

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
    if (url.includes("/auth/")) {
      authCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/auth/reset-confirm")) {
        return new Response(JSON.stringify({ token: "new-session", user: { id: "u1", email: "a@b.c", name: null } }), { status: 200 });
      }
      if (url.endsWith("/auth/providers")) return new Response(JSON.stringify({ google: false, passwordReset: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
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
    const total = new URL(url).searchParams.get("count") === "1" ? { total: 42 } : {};
    return new Response(JSON.stringify({ records: limit ? store.slice(0, limit) : store, ...total }), { status: 200 });
  });
  const mkStore = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  vi.stubGlobal("window", {
    location: { hash: "#petal_reset=reset-abc", pathname: "/reset-password", search: "", origin: "https://hearth.buildwithpetal.com", assign: (u: string) => (assigned = u) },
    history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => (replaced = u) },
    localStorage: mkStore(storage),
    sessionStorage: mkStore(session),
  });
  const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
  db = mod.db;
  authApi = mod.auth;
  getToken = mod.getToken;
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

describe("server-side filtering from the site", () => {
  it("sends where, sort, paging and count to the server", async () => {
    const res = await db.list("recipes", {
      everyone: true,
      where: { category: "dessert", minutes: { lte: 30 } },
      sort: "-createdAt",
      limit: 12,
      offset: 24,
      count: true,
    });
    const q = new URL(listUrls.at(-1)!).searchParams;
    expect(JSON.parse(q.get("where")!)).toEqual({ category: "dessert", minutes: { lte: 30 } });
    expect(q.get("sort")).toBe("-createdAt");
    expect(q.get("limit")).toBe("12");
    expect(q.get("offset")).toBe("24");
    expect(q.get("count")).toBe("1");
    expect((res as unknown as { total: number }).total).toBe(42);
  });
  it("a plain list sends no filter", async () => {
    await db.list("recipes");
    const q = new URL(listUrls.at(-1)!).searchParams;
    expect(q.get("where")).toBeNull();
    expect(q.get("sort")).toBeNull();
  });
});

describe("password reset from the site", () => {
  it("keeps the reset secret from the email link and clears it from the address bar", () => {
    expect(authApi.isRecovery()).toBe(true);
    expect(replaced).toBe("/reset-password");
  });
  it("asks for the reset email with a link back to this site's /reset-password", async () => {
    await authApi.requestPasswordReset("a@b.c");
    const call = authCalls.find((c) => c.url.endsWith("/auth/reset-request"))!;
    expect(call.body).toEqual({ email: "a@b.c", redirectTo: "https://hearth.buildwithpetal.com/reset-password" });
  });
  it("saving the new password uses the link once and signs the visitor in", async () => {
    await authApi.updatePassword("new-password-1");
    const call = authCalls.find((c) => c.url.endsWith("/auth/reset-confirm"))!;
    expect(call.body).toEqual({ token: "reset-abc", password: "new-password-1" });
    expect(getToken()).toBe("new-session");
    expect(authApi.isRecovery()).toBe(false);
  });
  it("a later password change goes through the signed-in route", async () => {
    await authApi.updatePassword("another-pass");
    expect(authCalls.at(-1)!.url.endsWith("/auth/password")).toBe(true);
  });
});

describe("Google sign-in from the site", () => {
  it("opens Petal's Google start with this site, its key and the return page", () => {
    authApi.signInWithGoogle("/dashboard");
    const u = new URL(assigned);
    expect(u.origin + u.pathname).toBe("https://petalapp.lovable.app/api/public/shared-oauth/google/start");
    expect(u.searchParams.get("project")).toBe("p1");
    expect(u.searchParams.get("key")).toBe("key-12345678");
    expect(u.searchParams.get("redirect")).toBe("https://hearth.buildwithpetal.com/dashboard");
  });
});
