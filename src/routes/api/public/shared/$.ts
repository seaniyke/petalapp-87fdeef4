/**
 * Shared backend tier — public data API.
 *
 * Generated apps on the free (shared) tier talk to this endpoint instead of a
 * dedicated Supabase project. Auth is the project's public API key plus an
 * optional end-user bearer token; every query is scoped to `projectId`
 * server-side, so one app can never read another app's rows.
 *
 *   POST   /api/public/shared/:projectId/auth/signup   { email, password, name? }
 *   POST   /api/public/shared/:projectId/auth/signin   { email, password }
 *   GET    /api/public/shared/:projectId/auth/me
 *   GET    /api/public/shared/:projectId/records/:collection?mine=1&limit=&offset=
 *   POST   /api/public/shared/:projectId/records/:collection    { ...fields }
 *   PATCH  /api/public/shared/:projectId/records/:collection/:id
 *   DELETE /api/public/shared/:projectId/records/:collection/:id
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  createRecord,
  deleteRecord,
  getUserById,
  issueUserToken,
  listRecords,
  resolveProjectByKey,
  signInUser,
  signUpUser,
  updateRecord,
  verifyUserToken,
} from "@/server/shared-backend.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-petal-key, authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const UUID = z.string().uuid();
const Credentials = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(200),
  name: z.string().trim().max(120).optional(),
});

function segments(request: Request): string[] {
  const path = new URL(request.url).pathname;
  const after = path.split("/api/public/shared/")[1] ?? "";
  return after.split("/").filter(Boolean).map(decodeURIComponent);
}

async function handle(request: Request): Promise<Response> {
  const parts = segments(request);
  const projectId = parts[0];
  if (!UUID.safeParse(projectId).success) return json({ error: "Invalid project id" }, 400);

  const apiKey = request.headers.get("x-petal-key");
  const ok = await resolveProjectByKey(projectId, apiKey);
  if (!ok) return json({ error: "Invalid or missing project key" }, 401);

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const userId = await verifyUserToken(projectId, bearer);

  const section = parts[1];

  /* ---------------- auth ---------------- */
  if (section === "auth") {
    const op = parts[2];
    if (op === "me") {
      if (!userId) return json({ user: null });
      return json({ user: await getUserById(projectId, userId) });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const parsed = Credentials.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
    }
    try {
      if (op === "signup") {
        const user = await signUpUser({
          projectId,
          email: parsed.data.email,
          password: parsed.data.password,
          displayName: parsed.data.name ?? null,
        });
        return json({ user, token: await issueUserToken(projectId, user.id) });
      }
      if (op === "signin") {
        const user = await signInUser({
          projectId,
          email: parsed.data.email,
          password: parsed.data.password,
        });
        if (!user) return json({ error: "Wrong email or password" }, 401);
        return json({ user, token: await issueUserToken(projectId, user.id) });
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Auth failed" }, 400);
    }
    return json({ error: "Unknown auth action" }, 404);
  }

  /* ---------------- records ---------------- */
  if (section === "records") {
    const collection = parts[2];
    if (!collection || !/^[a-z0-9_-]{1,64}$/i.test(collection)) {
      return json({ error: "Invalid collection name" }, 400);
    }
    const recordId = parts[3];
    const url = new URL(request.url);
    const mine = url.searchParams.get("mine") === "1";
    const scopeKey = mine || recordId ? userId : null;
    if (mine && !userId) return json({ error: "Sign in required" }, 401);

    try {
      if (request.method === "GET") {
        const rows = await listRecords({
          projectId,
          collection,
          ownerKey: mine ? userId : null,
          limit: Number(url.searchParams.get("limit") ?? 50),
          offset: Number(url.searchParams.get("offset") ?? 0),
        });
        return json({ records: rows });
      }
      if (request.method === "POST") {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);
        const row = await createRecord({ projectId, collection, ownerKey: userId, data: body });
        return json({ record: row }, 201);
      }
      if (request.method === "PATCH") {
        if (!recordId) return json({ error: "Missing record id" }, 400);
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);
        const row = await updateRecord({ projectId, id: recordId, ownerKey: scopeKey, data: body });
        if (!row) return json({ error: "Not found" }, 404);
        return json({ record: row });
      }
      if (request.method === "DELETE") {
        if (!recordId) return json({ error: "Missing record id" }, 400);
        const done = await deleteRecord({ projectId, id: recordId, ownerKey: scopeKey });
        if (!done) return json({ error: "Not found" }, 404);
        return json({ ok: true });
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Request failed" }, 400);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  return json({ error: "Unknown endpoint" }, 404);
}

export const Route = createFileRoute("/api/public/shared/$")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      PATCH: ({ request }) => handle(request),
      DELETE: ({ request }) => handle(request),
    },
  },
});
