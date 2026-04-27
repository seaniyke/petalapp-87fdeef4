/**
 * Integration env injector — turns installed integrations (with their
 * encrypted secrets) into env files that get shipped to the builder along
 * with the project's source.
 *
 * Why two files?
 *  - `.env.production`  → consumed by Vite at `vite build` time. Anything
 *    referenced as `import.meta.env.VITE_*` gets statically replaced into
 *    the client bundle. This is what client-side scaffolds (e.g. Plausible
 *    domain, public publishable keys) need.
 *  - `.dev.vars`        → Cloudflare Pages convention for local `wrangler
 *    pages dev`, plus we re-use it as a manifest for non-VITE secrets that
 *    a future server runtime (Pages Functions / Workers) would consume via
 *    `process.env`. Today the deploy is a static SPA so server-only keys
 *    are inert until that runtime exists, but we still ship them so the
 *    user can iterate locally and so a future builder change picks them up
 *    with no extra work.
 *
 * Naming convention:
 *   Each field becomes `<INTEGRATION>_<FIELD>`, uppercased, dashes → underscores.
 *   Public (non-secret) fields ALSO get a `VITE_<INTEGRATION>_<FIELD>` alias so
 *   client code can read them through Vite's static replacement. Secret fields
 *   never get a VITE_ alias (would leak the value into the client bundle).
 *
 * Safety:
 *   - We do not overwrite an existing user-authored `.env.production`. If the
 *     user has one, we merge: their lines win, integration lines fill the gaps.
 *   - Comments in the generated file mark the managed block so Petal can
 *     re-render it on the next install/uninstall without clobbering manual
 *     edits.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ProjectFile } from "@/server/generate.server";
import { getIntegration } from "./registry.server";
import { loadIntegrationSecrets } from "./installer.server";
import type { IntegrationCredentials, IntegrationField } from "./types";

const MANAGED_HEADER = "# >>> petal:integrations (managed — do not edit between markers)";
const MANAGED_FOOTER = "# <<< petal:integrations";

function envKey(integrationCode: string, fieldId: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return `${slug(integrationCode)}_${slug(fieldId)}`;
}

function escapeEnvValue(v: string): string {
  // Double-quote and escape \, ", $, ` so dotenv parses it back faithfully.
  const escaped = v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/\r?\n/g, "\\n");
  return `"${escaped}"`;
}

type FieldEntry = {
  field: IntegrationField;
  value: string;
};

/**
 * Render the managed env block (without the markers). One line per env var.
 * Public fields are emitted twice — once raw and once with `VITE_` prefix —
 * so both server-style and Vite-bundled reads work.
 */
function renderManagedLines(
  perIntegration: Array<{ code: string; fields: FieldEntry[] }>,
  opts: { includeSecrets: boolean },
): string {
  const lines: string[] = [];
  for (const { code, fields } of perIntegration) {
    if (fields.length === 0) continue;
    lines.push(`# --- ${code} ---`);
    for (const { field, value } of fields) {
      const key = envKey(code, field.id);
      const isSecret = field.kind === "secret";
      if (isSecret && !opts.includeSecrets) continue;
      lines.push(`${key}=${escapeEnvValue(value)}`);
      if (!isSecret) {
        // Public fields get a VITE_-prefixed alias for client-side reads.
        lines.push(`VITE_${key}=${escapeEnvValue(value)}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Splice the managed block into an existing env file's content. If the
 * markers are absent we append; if present we replace just that region.
 * Empty managed block → strip the markers entirely so we don't leave
 * orphan comments behind after the last integration is removed.
 */
function spliceManagedBlock(existing: string | null, managedLines: string): string {
  const trimmedExisting = (existing ?? "").replace(/\s+$/, "");
  const block = managedLines.trim()
    ? `${MANAGED_HEADER}\n${managedLines}\n${MANAGED_FOOTER}`
    : "";

  if (!trimmedExisting) return block ? `${block}\n` : "";

  const re = new RegExp(
    `${MANAGED_HEADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${MANAGED_FOOTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "m",
  );
  if (re.test(trimmedExisting)) {
    const replaced = trimmedExisting.replace(re, block ? `${block}\n` : "").replace(/\s+$/, "");
    return replaced ? `${replaced}\n` : "";
  }
  return block ? `${trimmedExisting}\n\n${block}\n` : `${trimmedExisting}\n`;
}

export type IntegrationEnvBundle = {
  /** ProjectFile entries to merge into the build payload. */
  files: ProjectFile[];
  /** Quick stat for logging — how many integrations contributed env vars. */
  integrationCount: number;
  /** Names that ended up in the file (no values), for telemetry. */
  envKeys: string[];
};

/**
 * Build env files for the given project, ready to be appended to the
 * `files[]` array sent to the builder. Existing user content in those
 * files (if present in `currentFiles`) is preserved outside the managed
 * markers.
 */
export async function buildIntegrationEnvFiles(
  projectId: string,
  currentFiles: ProjectFile[],
): Promise<IntegrationEnvBundle> {
  // 1) Load installed integrations.
  const { data: rows, error } = await supabaseAdmin
    .from("project_integrations")
    .select("id, integration_code, options")
    .eq("project_id", projectId);
  if (error || !rows || rows.length === 0) {
    return { files: [], integrationCount: 0, envKeys: [] };
  }

  // 2) For each, gather the field values (public from `options`, secret from
  //    the encrypted store via the installer's loader).
  const perIntegration: Array<{ code: string; fields: FieldEntry[] }> = [];
  for (const row of rows) {
    const def = getIntegration(row.integration_code);
    if (!def) continue; // Definition was removed — skip silently.
    const publicValues = (row.options ?? {}) as IntegrationCredentials;
    const secretValues = await loadIntegrationSecrets(projectId, def.code);
    const merged: IntegrationCredentials = { ...publicValues, ...secretValues };

    const fields: FieldEntry[] = [];
    for (const f of def.fields) {
      const v = merged[f.id];
      if (typeof v === "string" && v.length > 0) {
        fields.push({ field: f, value: v });
      }
    }
    perIntegration.push({ code: def.code, fields });
  }

  // 3) Render the two managed blocks.
  const productionLines = renderManagedLines(perIntegration, { includeSecrets: false });
  const devVarsLines = renderManagedLines(perIntegration, { includeSecrets: true });

  const findCurrent = (path: string): string | null =>
    currentFiles.find((f) => f.path === path)?.content ?? null;

  const files: ProjectFile[] = [];
  const envProdContent = spliceManagedBlock(findCurrent(".env.production"), productionLines);
  if (envProdContent) {
    files.push({ path: ".env.production", content: envProdContent });
  }
  const devVarsContent = spliceManagedBlock(findCurrent(".dev.vars"), devVarsLines);
  if (devVarsContent) {
    files.push({ path: ".dev.vars", content: devVarsContent });
  }

  // 4) Collect env key names for logging.
  const envKeys: string[] = [];
  for (const { code, fields } of perIntegration) {
    for (const { field } of fields) {
      const key = envKey(code, field.id);
      envKeys.push(key);
      if (field.kind !== "secret") envKeys.push(`VITE_${key}`);
    }
  }

  return {
    files,
    integrationCount: perIntegration.filter((p) => p.fields.length > 0).length,
    envKeys,
  };
}

/**
 * Merge env-file ProjectFile entries into a build payload, replacing any
 * existing entries with the same path. Pure helper used by the trigger.
 */
export function mergeFilesIntoPayload(
  base: ProjectFile[],
  overrides: ProjectFile[],
): ProjectFile[] {
  if (overrides.length === 0) return base;
  const overridePaths = new Set(overrides.map((f) => f.path));
  return [...base.filter((f) => !overridePaths.has(f.path)), ...overrides];
}
