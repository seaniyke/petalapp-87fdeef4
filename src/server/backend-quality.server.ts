/**
 * Phase 4 — Backend Quality Bible enforcement (deterministic linter).
 *
 * Source: docs/petal-backend-quality-bible.md §8 (security checklist) and
 * §9 (operational floor). The RLS sanity linter (`rls-sanity-linter.ts`)
 * already covers "table exists / RLS on / has a policy". This module covers
 * the rest of the checklist that can be decided statically from the file set:
 *
 *   B1 MISSING_GRANT      — `CREATE TABLE public.x` with no GRANT for x.
 *   B2 ROLE_ON_PROFILE    — a `role` column on profiles/users (privilege
 *                           escalation; roles belong in their own table).
 *   B3 DESTRUCTIVE_DDL    — DROP TABLE / DROP COLUMN / TRUNCATE / DELETE FROM
 *                           without a WHERE, in a generated migration.
 *   B4 SENSITIVE_PUBLIC_READ — a policy granting anon (or USING (true)) read
 *                           on a table whose name implies private data.
 *   B5 WRITE_POLICY_NO_CHECK — FOR INSERT / FOR ALL policy with no WITH CHECK,
 *                           i.e. any user can write any row.
 *   B6 SECRET_IN_CLIENT   — service-role key or a non-VITE secret env var
 *                           referenced from a client-reachable module.
 *   B7 UNVALIDATED_SERVER_FN — `createServerFn` with a mutating method and no
 *                           `.inputValidator(...)`.
 *
 * All rules are conservative (a false positive must never wedge a clean
 * turn) and emit SOFT warnings through the same `LocalIssue` channel the
 * autofix loop consumes.
 */

import type { LocalIssue } from "@/server/local-verifier";

export type BackendRule = "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7";

const ENABLED_RULES = new Set<BackendRule>(["B1", "B2", "B3", "B4", "B5", "B6", "B7"]);

const MIGRATION_PATH = /^supabase\/migrations\/.+\.sql$/i;
const CODE_PATH = /\.(tsx?|jsx?)$/;

/** Files that never ship to the browser. */
function isServerOnly(path: string): boolean {
  return (
    /\.server\.(tsx?|jsx?)$/.test(path) ||
    path.startsWith("src/server/") ||
    path.startsWith("supabase/functions/") ||
    path.startsWith("src/routes/api/")
  );
}

const SENSITIVE_TABLE =
  /(profile|user|account|payment|invoice|order|subscription|billing|secret|api_key|token|credential|message|conversation|session|address|customer|patient|medical|ssn|kyc)/i;

export interface BackendFile {
  path: string;
  content: string;
}

function stripSqlNoise(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === "-" && c2 === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function bare(raw: string): string {
  const cleaned = raw.replace(/"/g, "").trim();
  const parts = cleaned.split(".");
  return parts[parts.length - 1].toLowerCase();
}

/** Slice out the parenthesised column list of a CREATE TABLE statement. */
function tableBody(sql: string, fromIndex: number): string {
  const open = sql.indexOf("(", fromIndex);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return "";
}

/** Split policy statements so each can be inspected on its own. */
function policyStatements(sql: string): string[] {
  const out: string[] = [];
  const re = /create\s+policy\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const end = sql.indexOf(";", m.index);
    out.push(sql.slice(m.index, end === -1 ? sql.length : end));
  }
  return out;
}

export function lintBackendQuality(files: BackendFile[]): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const seen = new Set<string>();
  const push = (rule: BackendRule, path: string, key: string, detail: string) => {
    if (!ENABLED_RULES.has(rule)) return;
    const k = `${rule}::${path}::${key}`;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push({ path, kind: "backend-quality", detail });
  };

  const migrations = files.filter((f) => MIGRATION_PATH.test(f.path));
  const allSql = migrations.map((f) => stripSqlNoise(f.content)).join("\n");

  // Grants across the whole migration set (a later migration may grant).
  const grantedTables = new Set<string>();
  {
    const re = /grant\s+[\w\s,]+?\s+on\s+(?:table\s+)?((?:"[^"]+"|[a-z_][\w]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w]*))?)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(allSql))) grantedTables.add(bare(m[1]));
    if (/grant\s+[\w\s,]+?\s+on\s+all\s+tables/i.test(allSql)) grantedTables.add("*");
  }

  for (const file of migrations) {
    const sql = stripSqlNoise(file.content);

    // B1 + B2 — per CREATE TABLE.
    const createRe =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][\w]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w]*))?)/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      const table = bare(m[1]);
      const qualified = m[1].replace(/"/g, "").trim().toLowerCase();
      const isPublic = !qualified.includes(".") || qualified.startsWith("public.");
      if (!isPublic) continue;

      if (!grantedTables.has(table) && !grantedTables.has("*")) {
        push(
          "B1",
          file.path,
          table,
          `Table "${table}" is created in the public schema with no GRANT. PostgREST cannot reach it — add \`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated;\` and \`GRANT ALL ON public.${table} TO service_role;\` in the same migration (plus \`GRANT SELECT ... TO anon\` only if a policy allows anon reads).`,
        );
      }

      if (/^(profiles?|users?|accounts?|members?)$/.test(table)) {
        const body = tableBody(sql, m.index);
        if (/(^|,|\s)"?(role|roles|is_admin|admin|user_role)"?\s+(text|varchar|boolean|bool|app_role|user_role|citext)/i.test(body)) {
          push(
            "B2",
            file.path,
            table,
            `Table "${table}" stores a role/admin flag on the profile row. That is a privilege-escalation hole: any user who can update their own row can make themselves admin. Move roles to a separate \`user_roles\` table with an \`app_role\` enum and check them through a SECURITY DEFINER \`has_role()\` function.`,
          );
        }
      }
    }

    // B3 — destructive DDL/DML.
    const destructive: Array<[RegExp, string]> = [
      [/\bdrop\s+table\b/i, "DROP TABLE"],
      [/\balter\s+table\s+[^;]*\bdrop\s+column\b/i, "DROP COLUMN"],
      [/\btruncate\b/i, "TRUNCATE"],
      [/\bdelete\s+from\s+[^;]*?;/i, "DELETE without WHERE"],
    ];
    for (const [re, label] of destructive) {
      const hit = re.exec(sql);
      if (!hit) continue;
      if (label === "DELETE without WHERE" && /\bwhere\b/i.test(hit[0])) continue;
      push(
        "B3",
        file.path,
        label,
        `Migration contains ${label}. Destructive migrations must only run when the user explicitly asked for the data or column to be removed — otherwise use an additive change (new column / new table) and leave existing data intact.`,
      );
    }

    // B4 + B5 — per policy statement.
    for (const stmt of policyStatements(sql)) {
      const onMatch = /\son\s+((?:"[^"]+"|[a-z_][\w]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w]*))?)/i.exec(stmt);
      const table = onMatch ? bare(onMatch[1]) : "unknown";
      const forMatch = /\sfor\s+(all|select|insert|update|delete)\b/i.exec(stmt);
      const action = (forMatch?.[1] ?? "all").toLowerCase();
      const toAnon = /\sto\s+[^;]*\banon\b/i.test(stmt) || /\sto\s+public\b/i.test(stmt);
      const usingTrue = /\busing\s*\(\s*true\s*\)/i.test(stmt);

      if (
        (action === "select" || action === "all") &&
        (toAnon || usingTrue) &&
        SENSITIVE_TABLE.test(table)
      ) {
        push(
          "B4",
          file.path,
          `${table}:read`,
          `Policy on "${table}" grants unrestricted read (${toAnon ? "TO anon/public" : "USING (true)"}). This table name implies private data — scope the policy to the owner (\`USING (auth.uid() = user_id)\`) or to a role check, and expose only the columns that are genuinely public through a view.`,
        );
      }

      if (
        (action === "insert" || action === "all" || action === "update") &&
        !/\bwith\s+check\b/i.test(stmt)
      ) {
        push(
          "B5",
          file.path,
          `${table}:${action}`,
          `Write policy on "${table}" (FOR ${action.toUpperCase()}) has no WITH CHECK clause, so a user can write rows they do not own. Add \`WITH CHECK (auth.uid() = user_id)\` (or the equivalent ownership predicate).`,
        );
      }
    }
  }

  // B6 + B7 — code files.
  for (const file of files) {
    if (!CODE_PATH.test(file.path)) continue;
    const src = file.content;

    if (!isServerOnly(file.path)) {
      const secretHit =
        /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_|SECRET_KEY|PRIVATE_KEY|\bsk_live_|\bsk_test_/.exec(src);
      if (secretHit) {
        push(
          "B6",
          file.path,
          secretHit[0],
          `Client-reachable module references \`${secretHit[0]}\`. Secrets and the service-role key must only be read inside a server function handler (\`*.server.ts\`, \`src/server/**\`, or an API route). Move this call server-side and expose a typed server function instead.`,
        );
      }
      if (/\bprocess\.env\.(?!NODE_ENV)/.test(src)) {
        push(
          "B6",
          file.path,
          "process.env",
          `Client-reachable module reads \`process.env\`. Browser config must use \`import.meta.env.VITE_*\`; server-only values belong inside a server function handler.`,
        );
      }
    }

    const fnRe = /createServerFn\s*\(\s*\{[^}]*method\s*:\s*['"](POST|PUT|PATCH|DELETE)['"]/gi;
    let f: RegExpExecArray | null;
    while ((f = fnRe.exec(src))) {
      const tail = src.slice(f.index, f.index + 1200);
      if (!/\.inputValidator\s*\(/.test(tail)) {
        push(
          "B7",
          file.path,
          `serverfn:${f.index}`,
          `A mutating server function in this file has no \`.inputValidator(...)\`. Every server function that accepts input must validate it with a zod schema before the handler runs — unvalidated input is the most common backend hole in generated apps.`,
        );
      }
    }
  }

  return issues;
}
