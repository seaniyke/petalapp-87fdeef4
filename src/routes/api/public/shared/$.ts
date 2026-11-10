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
 *   GET    /api/public/shared/:projectId/auth/providers        → { google, passwordReset }
 *   POST   /api/public/shared/:projectId/auth/reset-request    { email, redirectTo }
 *   POST   /api/public/shared/:projectId/auth/reset-confirm    { token, password }
 *   POST   /api/public/shared/:projectId/auth/password         { password } (signed in)
 *   GET    /api/public/shared/:projectId/records/:collection?mine=1&limit=&offset=
 *   POST   /api/public/shared/:projectId/records/:collection    { ...fields }
 *   PATCH  /api/public/shared/:projectId/records/:collection/:id
 *   DELETE /api/public/shared/:projectId/records/:collection/:id
 */
import type { RecordScope } from "@/server/shared-backend.server";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  createRecord,
  seedRecords,
  deleteRecord,
  getUserById,
  issueUserToken,
  listRecords,
  resolveProjectAccess,
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

const NewPassword = z.object({ password: z.string().min(6).max(200) });
const ResetRequest = z.object({
  email: z.string().trim().email().max(255),
  redirectTo: z.string().url().max(2000),
});
const ResetConfirm = z.object({ token: z.string().min(20).max(200), password: z.string().min(6).max(200) });

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
  const access = await resolveProjectAccess(projectId, apiKey);
  if (access === "unavailable") {
    // Our side is down or misconfigured — say so, and let the app retry
    // (its client falls back to another Kimble origin on a 503).
    return json({ error: "Backend temporarily unavailable. Please try again." }, 503);
  }
  if (access === "no_backend") {
    return json({ error: "This app has no backend set up yet." }, 404);
  }
  if (access === "paused") {
    return json(
      { error: "backend_paused", message: "This service is temporarily paused. Please contact the site owner." },
      402,
    );
  }
  if (access !== "ok") return json({ error: "Invalid or missing project key" }, 401);

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
    if (op === "providers") {
      const { googleConfigured } = await import("@/server/shared-auth-rules");
      return json({ google: googleConfigured(process.env), passwordReset: true });
    }
    if (op === "reset-request" || op === "reset-confirm" || op === "password") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const sa = await import("@/server/shared-auth.server");
      const body = await request.json().catch(() => null);
      try {
        if (op === "reset-request") {
          const p = ResetRequest.safeParse(body);
          if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid input" }, 400);
          const r = await sa.requestPasswordReset({ projectId, email: p.data.email, redirectTo: p.data.redirectTo });
          return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
        }
        if (op === "reset-confirm") {
          const p = ResetConfirm.safeParse(body);
          if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid input" }, 400);
          const r = await sa.confirmPasswordReset({ projectId, token: p.data.token, password: p.data.password });
          if (!r) return json({ error: "This reset link has expired or was already used. Ask for a new one." }, 400);
          return json(r);
        }
        if (!userId) return json({ error: "Sign in required" }, 401);
        const p = NewPassword.safeParse(body);
        if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Invalid input" }, 400);
        const user = await sa.changePassword(projectId, userId, p.data.password);
        if (!user) return json({ error: "Account not found" }, 404);
        return json({ user });
      } catch (e) {
        console.error("[shared/auth]", op, e instanceof Error ? e.message : String(e));
        return json({ error: "Couldn't complete that right now. Please try again." }, 503);
      }
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
    // Writes are always ownership-scoped by the *verified* end-user token.
    // Never derive the scope from anything the caller can choose.
    const scopeKey = userId;
    if (mine && !userId) return json({ error: "Sign in required" }, 401);

    // Reads default to "shared" (own rows + un-owned guest rows). A caller
    // must ask for `scope=all` explicitly to read a genuinely public
    // collection — it is never the implicit behaviour, because that leaked
    // every end user's rows to every other end user.
    const rawScope = url.searchParams.get("scope");
    const scope: RecordScope =
      mine || rawScope === "own" ? "own" : rawScope === "all" ? "all" : "shared";

    try {
      if (request.method === "GET") {
        const { parseRecordQuery, QueryError } = await import("@/server/shared-query");
        let query;
        try {
          query = parseRecordQuery(url.searchParams);
        } catch (e) {
          if (e instanceof QueryError) return json({ error: e.message }, 400);
          throw e;
        }
        const withTotal = url.searchParams.get("count") === "1";
        const rows = await listRecords({
          projectId,
          collection,
          ownerKey: userId,
          scope,
          limit: Number(url.searchParams.get("limit") ?? 50),
          offset: Number(url.searchParams.get("offset") ?? 0),
          filters: query.filters,
          sort: query.sort,
          withTotal,
        });
        return json(withTotal ? { records: rows, total: rows.total } : { records: rows });
      }
      if (request.method === "POST" && recordId === "_seed") {
        const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
        if (!body || !Array.isArray(body.rows)) return json({ error: "Invalid body" }, 400);
        const result = await seedRecords({
          projectId,
          collection,
          rows: body.rows as Record<string, unknown>[],
        });
        return json(result, result.seeded ? 201 : 200);
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

  /* ---------------- uploads (Cloudflare R2) ---------------- */
  if (section === "uploads") {
    const { UPLOAD_LIMITS, uploadProjectFile, deleteProjectFile } = await import(
      "@/server/r2-storage.server"
    );
    try {
      if (request.method === "POST") {
        const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!(UPLOAD_LIMITS.allowedTypes as readonly string[]).includes(contentType)) {
          return json({ error: "Only images (JPG, PNG, WebP, GIF, AVIF) and PDFs can be uploaded." }, 415);
        }
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > UPLOAD_LIMITS.maxBytes) return json({ error: "File is larger than 5 MB." }, 413);
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength === 0) return json({ error: "Empty file" }, 400);
        if (bytes.byteLength > UPLOAD_LIMITS.maxBytes) {
          return json({ error: "File is larger than 5 MB." }, 413);
        }
        const name = new URL(request.url).searchParams.get("name") ?? "file";
        const file = await uploadProjectFile({
          projectId,
          ownerId: userId,
          fileName: name,
          contentType,
          bytes,
        });
        return json({ file }, 201);
      }
      if (request.method === "DELETE") {
        const key = parts.slice(2).join("/");
        if (!userId) return json({ error: "Sign in required" }, 401);
        const done = await deleteProjectFile(projectId, userId, key);
        if (!done) return json({ error: "Not found" }, 404);
        return json({ ok: true });
      }
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Upload failed" }, 400);
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
