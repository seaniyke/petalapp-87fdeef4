/**
 * Shared backend tier — server helpers.
 *
 * Free-tier projects get a real database, auth and REST API without Petal
 * spinning up a dedicated Supabase project per app. Every shared-tier app
 * stores its rows inside Petal's own Postgres in `shared_app_records`,
 * namespaced by `project_id` + `collection`, and its end users live in
 * `shared_app_users`.
 *
 * Isolation rules:
 *   - Nothing is reachable directly from a generated app's Supabase client.
 *     All traffic goes through `/api/public/shared/*` with the project's
 *     public API key, and every query is filtered by `project_id` server-side.
 *   - End-user sessions are stateless HMAC tokens scoped to one project.
 *   - `owner_key` scopes rows to the end user that created them, which is how
 *     we emulate RLS ("own rows only") on the shared tier.
 *
 * Server-only. Never import from client code.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Hard limits so one free app can't eat the shared instance. */
export const SHARED_LIMITS = {
  maxRowsPerProject: 5_000,
  maxCollections: 25,
  maxBytesPerRecord: 32_768,
  maxPageSize: 200,
} as const;

const enc = new TextEncoder();

function signingSecret(): string {
  return (
    process.env.PETAL_SIGNING_MASTER_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "petal-shared-dev-secret"
  );
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}

/* ---------------- passwords ---------------- */

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return `pbkdf2$100000$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltStr, hashStr] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromB64url(saltStr) as unknown as BufferSource,
      iterations: Number(iterStr) || 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  const got = b64url(new Uint8Array(bits));
  if (got.length !== hashStr.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashStr.charCodeAt(i);
  return diff === 0;
}

/* ---------------- end-user session tokens ---------------- */

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export async function issueUserToken(projectId: string, userId: string): Promise<string> {
  const payload = b64url(
    enc.encode(JSON.stringify({ p: projectId, u: userId, e: Date.now() + TOKEN_TTL_MS })),
  );
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyUserToken(
  projectId: string,
  token: string | null,
): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if ((await hmac(payload)) !== sig) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {
      p: string;
      u: string;
      e: number;
    };
    if (parsed.p !== projectId) return null;
    if (Date.now() > parsed.e) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

/* ---------------- enable / disable ---------------- */

export function generateApiKey(): string {
  return `petal_pk_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export type SharedBackend = {
  projectId: string;
  apiKey: string;
  enabledAt: string;
  rowCount: number;
};

export async function enableSharedBackend(projectId: string): Promise<SharedBackend> {
  const existing = await getSharedBackend(projectId);
  if (existing) return existing;

  const apiKey = generateApiKey();
  const { data, error } = await supabaseAdmin
    .from("shared_backends")
    .insert({ project_id: projectId, api_key: apiKey })
    .select("project_id, api_key, enabled_at, row_count")
    .single();
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("projects").update({ backend_type: "shared" }).eq("id", projectId);

  return {
    projectId: data.project_id as string,
    apiKey: data.api_key as string,
    enabledAt: data.enabled_at as string,
    rowCount: Number(data.row_count ?? 0),
  };
}

export async function disableSharedBackend(projectId: string): Promise<void> {
  await supabaseAdmin.from("shared_backends").delete().eq("project_id", projectId);
}

export async function getSharedBackend(projectId: string): Promise<SharedBackend | null> {
  const { data } = await supabaseAdmin
    .from("shared_backends")
    .select("project_id, api_key, enabled_at, row_count")
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return null;
  return {
    projectId: data.project_id as string,
    apiKey: data.api_key as string,
    enabledAt: data.enabled_at as string,
    rowCount: Number(data.row_count ?? 0),
  };
}

/** Resolve a project from the caller-supplied public API key. */
export async function resolveProjectByKey(
  projectId: string,
  apiKey: string | null,
): Promise<boolean> {
  if (!apiKey) return false;
  const backend = await getSharedBackend(projectId);
  if (!backend) return false;
  if (backend.apiKey !== apiKey) return false;
  void supabaseAdmin
    .from("shared_backends")
    .update({ last_active_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .then(() => undefined);
  return true;
}

/* ---------------- record CRUD ---------------- */

export type RecordRow = {
  id: string;
  collection: string;
  ownerKey: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const shape = (r: Record<string, unknown>): RecordRow => ({
  id: r.id as string,
  collection: r.collection as string,
  ownerKey: (r.owner_key as string | null) ?? null,
  data: (r.data as Record<string, unknown>) ?? {},
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export async function listRecords(opts: {
  projectId: string;
  collection: string;
  ownerKey?: string | null;
  limit?: number;
  offset?: number;
}): Promise<RecordRow[]> {
  const limit = Math.min(opts.limit ?? 50, SHARED_LIMITS.maxPageSize);
  let q = supabaseAdmin
    .from("shared_app_records")
    .select("id, collection, owner_key, data, created_at, updated_at")
    .eq("project_id", opts.projectId)
    .eq("collection", opts.collection)
    .order("created_at", { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + limit - 1);
  if (opts.ownerKey) q = q.eq("owner_key", opts.ownerKey);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(shape);
}

export async function createRecord(opts: {
  projectId: string;
  collection: string;
  ownerKey: string | null;
  data: Record<string, unknown>;
}): Promise<RecordRow> {
  if (JSON.stringify(opts.data).length > SHARED_LIMITS.maxBytesPerRecord) {
    throw new Error("Record is too large for the shared tier.");
  }
  const { count } = await supabaseAdmin
    .from("shared_app_records")
    .select("id", { count: "exact", head: true })
    .eq("project_id", opts.projectId);
  if ((count ?? 0) >= SHARED_LIMITS.maxRowsPerProject) {
    throw new Error(
      "This project hit the shared tier row limit. Upgrade to a dedicated backend for unlimited rows.",
    );
  }

  const { data, error } = await supabaseAdmin
    .from("shared_app_records")
    .insert({
      project_id: opts.projectId,
      collection: opts.collection,
      owner_key: opts.ownerKey,
      data: opts.data as never,
    })
    .select("id, collection, owner_key, data, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return shape(data);
}

export async function updateRecord(opts: {
  projectId: string;
  id: string;
  ownerKey: string | null;
  data: Record<string, unknown>;
}): Promise<RecordRow | null> {
  let q = supabaseAdmin
    .from("shared_app_records")
    .update({ data: opts.data as never })
    .eq("project_id", opts.projectId)
    .eq("id", opts.id);
  if (opts.ownerKey) q = q.eq("owner_key", opts.ownerKey);
  const { data, error } = await q
    .select("id, collection, owner_key, data, created_at, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? shape(data) : null;
}

export async function deleteRecord(opts: {
  projectId: string;
  id: string;
  ownerKey: string | null;
}): Promise<boolean> {
  let q = supabaseAdmin
    .from("shared_app_records")
    .delete()
    .eq("project_id", opts.projectId)
    .eq("id", opts.id);
  if (opts.ownerKey) q = q.eq("owner_key", opts.ownerKey);
  const { data, error } = await q.select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/* ---------------- end users ---------------- */

export async function signUpUser(opts: {
  projectId: string;
  email: string;
  password: string;
  displayName?: string | null;
}): Promise<{ id: string; email: string; displayName: string | null }> {
  const password_hash = await hashPassword(opts.password);
  const { data, error } = await supabaseAdmin
    .from("shared_app_users")
    .insert({
      project_id: opts.projectId,
      email: opts.email.toLowerCase(),
      password_hash,
      display_name: opts.displayName ?? null,
    })
    .select("id, email, display_name")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("An account with that email already exists.");
    throw new Error(error.message);
  }
  return {
    id: data.id as string,
    email: data.email as string,
    displayName: (data.display_name as string | null) ?? null,
  };
}

export async function signInUser(opts: {
  projectId: string;
  email: string;
  password: string;
}): Promise<{ id: string; email: string; displayName: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("shared_app_users")
    .select("id, email, display_name, password_hash")
    .eq("project_id", opts.projectId)
    .eq("email", opts.email.toLowerCase())
    .maybeSingle();
  if (!data) return null;
  const ok = await verifyPassword(opts.password, data.password_hash as string);
  if (!ok) return null;
  return {
    id: data.id as string,
    email: data.email as string,
    displayName: (data.display_name as string | null) ?? null,
  };
}

export async function getUserById(
  projectId: string,
  userId: string,
): Promise<{ id: string; email: string; displayName: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("shared_app_users")
    .select("id, email, display_name")
    .eq("project_id", projectId)
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    email: data.email as string,
    displayName: (data.display_name as string | null) ?? null,
  };
}

/** Owner-facing stats for the Cloud panel. */
export async function sharedUsage(projectId: string): Promise<{
  rows: number;
  users: number;
  collections: string[];
}> {
  const [{ count: rows }, { count: users }, { data: cols }] = await Promise.all([
    supabaseAdmin
      .from("shared_app_records")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabaseAdmin
      .from("shared_app_users")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabaseAdmin.from("shared_app_records").select("collection").eq("project_id", projectId).limit(500),
  ]);
  const collections = Array.from(new Set((cols ?? []).map((c) => c.collection as string)));
  return { rows: rows ?? 0, users: users ?? 0, collections };
}
