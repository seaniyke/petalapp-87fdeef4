/**
 * RLS sanity linter — Tier 2.9 (Phase 5b).
 *
 * Catches the "ships an app that 403s on every query" failure mode that
 * passes every earlier tier (syntax-clean, render-clean, build-clean) but
 * dies the moment a real user hits the app because RLS is missing or
 * mis-configured.
 *
 * What it checks (three rules, all conservative — false positives must
 * never wedge a clean turn):
 *
 *   M1 — MISSING_TABLE.
 *     `supabase.from('foo')` references a table that does NOT appear in
 *     any `CREATE TABLE` statement across all migration files in the file
 *     set. Catches typos and forgotten migrations.
 *
 *   M2 — NO_RLS.
 *     The table exists in a migration but has no
 *     `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statement targeting it.
 *     Without RLS, the table is fully open via the publishable key — a
 *     security flaw the audit specifically called out.
 *
 *   M3 — NO_POLICY.
 *     RLS is enabled but no `CREATE POLICY ... ON <table>` exists. RLS
 *     with no policies = every query 403s for non-service-role users.
 *
 * SKIPS:
 *   - Reserved schemas: `auth.*`, `storage.*`, `realtime.*`, `vault.*`,
 *     `supabase_functions.*` (managed by Supabase, not us).
 *   - Files using `supabaseAdmin` (RLS bypassed by design).
 *   - Files in `src/integrations/` (scaffold).
 *   - `.from(<dynamic>)` calls — only literal string-arg calls are scanned.
 *
 * Each rule is independently disable-able for emergency rollback by
 * editing ENABLED_RULES.
 *
 * Why deterministic instead of an actual DB introspection:
 *   - The pipeline runs in a Cloudflare Worker; no DB connection at
 *     verify-time.
 *   - The migration files in the file set ARE the source of truth for
 *     schema state at this point in the turn.
 *   - Runs in <20ms; no LLM cost.
 */

import type { LocalIssue } from "@/server/local-verifier";

/** Limit which rules fire. Edit to disable individual rules in production. */
const ENABLED_RULES = new Set<"M1" | "M2" | "M3">(["M1", "M2", "M3"]);

const SCANNABLE_CODE = /\.(tsx?|jsx?)$/;
const MIGRATION_PATH = /^supabase\/migrations\/.+\.sql$/i;

const SKIP_PREFIXES = ["src/integrations/"];

const RESERVED_SCHEMAS = new Set([
  "auth",
  "storage",
  "realtime",
  "vault",
  "supabase_functions",
  "pg_catalog",
  "information_schema",
]);

interface FileLike {
  path: string;
  content: string;
}

interface FromCall {
  /** File the call appears in. */
  path: string;
  /** Bare table name (schema stripped). */
  table: string;
  /** True if the call site uses the admin/service-role client. */
  viaAdmin: boolean;
}

interface SchemaState {
  /** Set of table names that have a CREATE TABLE statement. */
  created: Set<string>;
  /** Subset of `created` whose RLS is explicitly enabled. */
  rlsEnabled: Set<string>;
  /** Subset of `created` that has at least one CREATE POLICY targeting it. */
  hasPolicy: Set<string>;
}

/**
 * Strip SQL comments (-- to EOL, /* ... *​/) so regex scans don't match
 * statements inside comments.
 */
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
    // Drop dollar-quoted bodies entirely ($$...$$) — function bodies that
    // can confuse statement-shape regex without adding signal here.
    if (c === "$" && c2 === "$") {
      i += 2;
      while (i < n && !(sql[i] === "$" && sql[i + 1] === "$")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Strip JS/TS strings + comments so regex scans don't match literals. */
function stripJsNoise(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Normalize a possibly-quoted identifier ("public"."foo" → foo, public.foo → foo). */
function bareTableName(raw: string): string {
  // Trim quotes/whitespace, drop optional schema prefix.
  const cleaned = raw.replace(/"/g, "").trim();
  const parts = cleaned.split(".");
  return parts[parts.length - 1];
}

/** Returns the schema part if explicitly qualified, else "". */
function schemaOf(raw: string): string {
  const cleaned = raw.replace(/"/g, "").trim();
  const parts = cleaned.split(".");
  if (parts.length < 2) return "";
  return parts[0];
}

/**
 * Parse migration files into a schema-state snapshot.
 * Tolerant: handles `IF NOT EXISTS`, schema-qualified names, quoted idents.
 */
function parseMigrations(migrations: FileLike[]): SchemaState {
  const state: SchemaState = {
    created: new Set(),
    rlsEnabled: new Set(),
    hasPolicy: new Set(),
  };

  for (const file of migrations) {
    const sql = stripSqlNoise(file.content);

    // CREATE TABLE [IF NOT EXISTS] [schema.]name ( ...
    const createRe =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][\w]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w]*))?)/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      const schema = schemaOf(m[1]);
      if (schema && RESERVED_SCHEMAS.has(schema.toLowerCase())) continue;
      state.created.add(bareTableName(m[1]));
    }

    // ALTER TABLE [schema.]name ENABLE ROW LEVEL SECURITY
    const rlsRe =
      /alter\s+table\s+(?:only\s+)?((?:"[^"]+"|[a-z_][\w]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w]*))?)\s+enable\s+row\s+level\s+security/gi;
    while ((m = rlsRe.exec(sql))) {
      const schema = schemaOf(m[1]);
      if (schema && RESERVED_SCHEMAS.has(schema.toLowerCase())) continue;
      state.rlsEnabled.add(bareTableName(m[1]));
    }

    // CREATE POLICY <name> ON [schema.]<table>
    const policyRe =
      /create\s+policy\s+(?:"[^"]+"|[a-z_][\w]*)\s+on\s+((?:"[^"]+"|[a-z_][\w]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w]*))?)/gi;
    while ((m = policyRe.exec(sql))) {
      const schema = schemaOf(m[1]);
      if (schema && RESERVED_SCHEMAS.has(schema.toLowerCase())) continue;
      state.hasPolicy.add(bareTableName(m[1]));
    }
  }

  return state;
}

/** Find every `<client>.from('table')` call in code files. */
function findFromCalls(codeFiles: FileLike[]): FromCall[] {
  const out: FromCall[] = [];
  // Match `<receiver>.from( 'name' )` or `.from( "name" )` — literal arg only.
  // We capture the receiver to detect `supabaseAdmin`.
  const re =
    /(?<![A-Za-z0-9_$])([A-Za-z_$][\w$]*)\s*\.\s*from\s*\(\s*['"]([^'"]+)['"]\s*[),]/g;

  for (const file of codeFiles) {
    if (!SCANNABLE_CODE.test(file.path)) continue;
    if (SKIP_PREFIXES.some((p) => file.path.startsWith(p))) continue;
    const clean = stripJsNoise(file.content);
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean))) {
      const receiver = m[1];
      // Filter to receivers that look like a Supabase client. Conservative:
      // we only want `supabase.from`, `supabaseAdmin.from`, `client.from`,
      // `db.from`, `sb.from`. This keeps us off arbitrary `array.from` /
      // `Object.from` / `URL.from` etc.
      const looksLikeSupabase =
        /^supabase|^sb$|^db$|^client$/i.test(receiver) ||
        receiver.toLowerCase().includes("supabase");
      // Also explicitly skip `Array.from` / `Object.from` / `URL.from` etc.
      if (/^(Array|Object|URL|Date|Map|Set|Promise|Number|String|Buffer|Reflect|Symbol)$/.test(receiver))
        continue;
      if (!looksLikeSupabase) continue;
      out.push({
        path: file.path,
        table: m[2],
        viaAdmin: /admin|service/i.test(receiver),
      });
    }
  }
  return out;
}

export function lintRlsSanity(
  files: FileLike[],
  changedPaths: string[],
): LocalIssue[] {
  const issues: LocalIssue[] = [];

  // We always scan the WHOLE migration set (a new code call may reference
  // a table created in any migration), but we only EMIT issues whose call
  // site lives in a changed file. That mirrors how the other tiers narrow
  // their output to the current turn.
  const changed = new Set(changedPaths);
  const migrations = files.filter((f) => MIGRATION_PATH.test(f.path));
  const codeFiles = files.filter((f) => changed.has(f.path));

  // No code changed this turn → nothing to flag.
  if (codeFiles.length === 0) return issues;

  const schema = parseMigrations(migrations);
  const calls = findFromCalls(codeFiles);

  // De-dup: one issue per (path, table, kind) so 10 calls to the same
  // table in one file don't produce 10 identical issues.
  const seen = new Set<string>();
  const push = (
    path: string,
    detail: string,
    rule: "M1" | "M2" | "M3",
    table: string,
  ) => {
    if (!ENABLED_RULES.has(rule)) return;
    const key = `${path}::${table}::${rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ path, kind: "rls-sanity", detail });
  };

  for (const call of calls) {
    if (call.viaAdmin) continue; // service role bypasses RLS by design.
    const t = call.table;

    // If we have NO migrations at all, the project may not use Supabase
    // for persistence yet (or migrations aren't in this file slice). Skip
    // M1/M2/M3 entirely to avoid false positives on early scaffolding.
    if (migrations.length === 0) continue;

    if (!schema.created.has(t)) {
      push(
        call.path,
        `supabase.from("${t}") references a table with no CREATE TABLE in any migration. Typo or missing migration?`,
        "M1",
        t,
      );
      continue;
    }
    if (!schema.rlsEnabled.has(t)) {
      push(
        call.path,
        `Table "${t}" is queried but has no ENABLE ROW LEVEL SECURITY. The table is fully open via the publishable key.`,
        "M2",
        t,
      );
      continue;
    }
    if (!schema.hasPolicy.has(t)) {
      push(
        call.path,
        `Table "${t}" has RLS enabled but no CREATE POLICY — every query will return 403 for non-admin users.`,
        "M3",
        t,
      );
    }
  }

  return issues;
}
