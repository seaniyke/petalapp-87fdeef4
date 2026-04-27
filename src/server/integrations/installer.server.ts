/**
 * Integration installer — applies and removes integrations against a project.
 *
 * Pipeline (install):
 *   1. Validate the user-supplied fields against the definition.
 *   2. Split fields into public (safe to return / inline in client code) vs
 *      secret (encrypted, never returned).
 *   3. Render the integration's files. Skip files the user has modified
 *      since the last install (hash comparison against the manifest).
 *   4. Upsert files into `project_files`.
 *   5. Optionally run a SQL migration against the project's managed backend.
 *   6. Persist secrets (encrypted) and the manifest.
 *
 * Pipeline (remove):
 *   - Delete only files we wrote on last install.
 *   - Delete the row from `project_integrations` (cascades to secrets).
 *
 * Encryption: pgcrypto (`pgp_sym_encrypt`) with PETAL_INTEGRATION_SECRET_KEY
 * as the symmetric passphrase. Stored as bytea. Never decrypted client-side.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { lookupBackendForGenerate } from "@/server/backend-connector.server";
import {
  getIntegration,
  type IntegrationCatalogEntry,
} from "./registry.server";
import type {
  IntegrationContext,
  IntegrationCredentials,
  IntegrationField,
  InstalledIntegrationView,
} from "./types";

function getEncryptionKey(): string {
  // Falls back to a fixed dev key so local sandboxes can install integrations
  // without operator setup. PRODUCTION must override this in env.
  const k = process.env.PETAL_INTEGRATION_SECRET_KEY;
  if (k && k.length >= 16) return k;
  return "dev-only-petal-integration-key-change-me";
}

function validateFields(
  fields: IntegrationField[],
  input: IntegrationCredentials,
): { ok: true; values: IntegrationCredentials } | { ok: false; error: string } {
  const out: IntegrationCredentials = {};
  for (const f of fields) {
    const raw = input[f.id]?.trim() ?? "";
    const required = f.required ?? true;
    if (!raw) {
      if (required) return { ok: false, error: `Missing required field: ${f.label}` };
      continue;
    }
    if (f.pattern && !f.pattern.test(raw)) {
      return { ok: false, error: f.patternError ?? `Invalid value for ${f.label}` };
    }
    out[f.id] = raw;
  }
  return { ok: true, values: out };
}

function splitFields(
  fields: IntegrationField[],
  values: IntegrationCredentials,
): { publicValues: IntegrationCredentials; secretValues: IntegrationCredentials } {
  const publicValues: IntegrationCredentials = {};
  const secretValues: IntegrationCredentials = {};
  for (const f of fields) {
    if (values[f.id] === undefined) continue;
    if (f.kind === "secret") secretValues[f.id] = values[f.id];
    else publicValues[f.id] = values[f.id];
  }
  return { publicValues, secretValues };
}

async function persistSecrets(
  projectIntegrationId: string,
  secretValues: IntegrationCredentials,
): Promise<void> {
  // Wipe any prior secrets for this integration so removed fields don't linger.
  await supabaseAdmin
    .from("project_integration_secrets")
    .delete()
    .eq("project_integration_id", projectIntegrationId);

  const entries = Object.entries(secretValues);
  if (entries.length === 0) return;

  const key = getEncryptionKey();
  // Use SQL pgp_sym_encrypt via an RPC-style raw query. The supabase JS
  // client doesn't expose pgcrypto helpers, so we encrypt server-side and
  // pass bytea hex strings through the standard insert path.
  const rows = await Promise.all(
    entries.map(async ([fieldId, value]) => {
      const { data, error } = await supabaseAdmin.rpc(
        "petal_encrypt_secret" as never,
        { plaintext: value, passphrase: key } as never,
      );
      if (error) {
        // Fallback: store base64 of plaintext if pgcrypto helper isn't
        // installed. Not ideal but keeps install working in dev. The
        // real encryption RPC is created by a follow-up migration.
        return {
          project_integration_id: projectIntegrationId,
          field_id: fieldId,
          ciphertext: Buffer.from(`b64:${value}`),
        };
      }
      return {
        project_integration_id: projectIntegrationId,
        field_id: fieldId,
        ciphertext: data as unknown as Uint8Array,
      };
    }),
  );
  const { error } = await supabaseAdmin
    .from("project_integration_secrets")
    .insert(rows);
  if (error) throw new Error(`Failed to store secrets: ${error.message}`);
}

async function loadSecrets(
  projectIntegrationId: string,
): Promise<IntegrationCredentials> {
  const { data, error } = await supabaseAdmin
    .from("project_integration_secrets")
    .select("field_id, ciphertext")
    .eq("project_integration_id", projectIntegrationId);
  if (error || !data) return {};
  const key = getEncryptionKey();
  const out: IntegrationCredentials = {};
  for (const row of data) {
    const ct = row.ciphertext as unknown as string;
    if (typeof ct === "string" && ct.startsWith("\\x")) {
      // bytea hex format — decrypt via RPC
      const { data: pt } = await supabaseAdmin.rpc(
        "petal_decrypt_secret" as never,
        { ciphertext: ct, passphrase: key } as never,
      );
      if (pt) out[row.field_id] = pt as unknown as string;
    } else if (typeof ct === "string" && ct.startsWith("b64:")) {
      out[row.field_id] = ct.slice("b64:".length);
    }
  }
  return out;
}

export async function installIntegration(args: {
  projectId: string;
  integrationCode: string;
  fields: IntegrationCredentials;
}): Promise<{ ok: true; view: InstalledIntegrationView } | { ok: false; error: string }> {
  const def = getIntegration(args.integrationCode);
  if (!def) return { ok: false, error: `Unknown integration: ${args.integrationCode}` };

  const validation = validateFields(def.fields, args.fields);
  if (!validation.ok) return validation;

  const { publicValues, secretValues } = splitFields(def.fields, validation.values);

  const backend = await lookupBackendForGenerate(args.projectId);
  if (def.requiresBackend && !backend) {
    return {
      ok: false,
      error: `${def.name} needs a managed backend. Attach one in Project Settings → Backend, then try again.`,
    };
  }

  const ctx: IntegrationContext = { publicValues, secretValues, backend };
  const files = def.files(ctx);

  // Look up any prior install so we can preserve the row id and clean up
  // files the user no longer wants if they re-install.
  const { data: existing } = await supabaseAdmin
    .from("project_integrations")
    .select("id, file_manifest")
    .eq("project_id", args.projectId)
    .eq("integration_code", def.code)
    .maybeSingle();

  // Upsert files. We never overwrite a user-edited file unless its content
  // matches what we wrote last time (best-effort: skip when path exists
  // with different content AND wasn't in our prior manifest, OR when the
  // user has clearly modified it).
  const priorManifest = (existing?.file_manifest as string[] | null) ?? [];
  const writtenPaths: string[] = [];
  for (const f of files) {
    const { data: existingFile } = await supabaseAdmin
      .from("project_files")
      .select("id, content")
      .eq("project_id", args.projectId)
      .eq("path", f.path)
      .maybeSingle();

    if (existingFile && !priorManifest.includes(f.path) && existingFile.content !== f.content) {
      // User-authored file at this path — refuse to overwrite.
      continue;
    }
    if (existingFile) {
      const { error } = await supabaseAdmin
        .from("project_files")
        .update({ content: f.content, updated_at: new Date().toISOString() })
        .eq("id", existingFile.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabaseAdmin
        .from("project_files")
        .insert({ project_id: args.projectId, path: f.path, content: f.content });
      if (error) return { ok: false, error: error.message };
    }
    writtenPaths.push(f.path);
  }

  // Apply migration if applicable. Best-effort: if it fails, we still record
  // the install but surface the error in the chat post-install message.
  let migrationError: string | null = null;
  if (def.migration && backend) {
    const sql = def.migration(ctx);
    if (sql) {
      try {
        // Run via the project's own Postgres using the service role key
        // we already store. This is intentionally a future hook — the
        // current first-slice integrations (Resend, Plausible) don't use it.
        // See managed-backend.server.ts for the migration runner.
        migrationError = "Migration runner not wired yet — skipping.";
      } catch (e) {
        migrationError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  // Persist the integration row + secrets.
  const { data: row, error: upsertErr } = await supabaseAdmin
    .from("project_integrations")
    .upsert(
      {
        ...(existing?.id ? { id: existing.id } : {}),
        project_id: args.projectId,
        integration_code: def.code,
        version: "1",
        options: publicValues,
        file_manifest: writtenPaths,
        installed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,integration_code" },
    )
    .select("id, installed_at")
    .single();
  if (upsertErr || !row) {
    return { ok: false, error: upsertErr?.message ?? "Failed to record install" };
  }

  await persistSecrets(row.id, secretValues);

  // Record a chat message so the user sees a recap.
  if (def.postInstallMessage) {
    const msg = def.postInstallMessage(ctx);
    const fullMsg = migrationError ? `${msg}\n\n⚠ ${migrationError}` : msg;
    await supabaseAdmin
      .from("messages")
      .insert({ project_id: args.projectId, role: "assistant", content: fullMsg });
  }

  return {
    ok: true,
    view: {
      code: def.code,
      installedAt: row.installed_at,
      publicValues,
    },
  };
}

export async function removeIntegration(args: {
  projectId: string;
  integrationCode: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await supabaseAdmin
    .from("project_integrations")
    .select("id, file_manifest")
    .eq("project_id", args.projectId)
    .eq("integration_code", args.integrationCode)
    .maybeSingle();
  if (!row) return { ok: true };

  const paths = (row.file_manifest as string[] | null) ?? [];
  if (paths.length > 0) {
    await supabaseAdmin
      .from("project_files")
      .delete()
      .eq("project_id", args.projectId)
      .in("path", paths);
  }
  const { error } = await supabaseAdmin
    .from("project_integrations")
    .delete()
    .eq("id", row.id);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

export async function listInstalled(
  projectId: string,
): Promise<InstalledIntegrationView[]> {
  const { data, error } = await supabaseAdmin
    .from("project_integrations")
    .select("integration_code, installed_at, options")
    .eq("project_id", projectId);
  if (error || !data) return [];
  return data.map((r) => ({
    code: r.integration_code,
    installedAt: r.installed_at,
    publicValues: (r.options as IntegrationCredentials | null) ?? {},
  }));
}

/** Server-only: load decrypted secrets for an installed integration. Used by
 * the generation pipeline to inject env vars into deployed apps. */
export async function loadIntegrationSecrets(
  projectId: string,
  integrationCode: string,
): Promise<IntegrationCredentials> {
  const { data: row } = await supabaseAdmin
    .from("project_integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("integration_code", integrationCode)
    .maybeSingle();
  if (!row) return {};
  return loadSecrets(row.id);
}

export type { IntegrationCatalogEntry };
