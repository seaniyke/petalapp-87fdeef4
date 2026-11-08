import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sharedBackendKit } from "../shared-backend-kit";

// Aurelia clinic: the sign-up page called signUpWithPassword({ email, password })
// and the server answered 400 "Expected string, received object".
async function loadAuth() {
  const client = sharedBackendKit({ baseUrl: "https://x.test", projectId: "p1", apiKey: "key-12345678" } as never)
    .find((f) => f.path.endsWith("client.ts"))!.content;
  const js = ts.transpileModule(client, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = join(mkdtempSync(join(tmpdir(), "kit-auth-")), "client.mjs");
  writeFileSync(file, js);
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("fetch", async (_u: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ token: "t", user: { id: "u1", email: "a@b.co" } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const mod = await import(pathToFileURL(file).href);
  return { auth: mod.auth, bodies };
}

describe("shared backend sign-up arguments", () => {
  it("object form sends plain email and password strings", async () => {
    const { auth, bodies } = await loadAuth();
    const r = await auth.signUpWithPassword({ email: "a@b.co", password: "pw123456" });
    expect(r.error).toBeNull();
    expect(bodies.at(-1)).toMatchObject({ email: "a@b.co", password: "pw123456" });
  });
  it("positional form still works for sign-in", async () => {
    const { auth, bodies } = await loadAuth();
    await auth.signInWithPassword("a@b.co", "pw123456");
    expect(bodies.at(-1)).toMatchObject({ email: "a@b.co", password: "pw123456" });
  });
});
