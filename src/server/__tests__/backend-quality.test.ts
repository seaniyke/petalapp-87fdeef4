import { describe, it, expect } from "vitest";
import { lintBackendQuality } from "../backend-quality.server";

const mig = (sql: string) => ({ path: "supabase/migrations/001_init.sql", content: sql });
const has = (issues: { detail: string }[], re: RegExp) => issues.some((i) => re.test(i.detail));

describe("backend quality linter", () => {
  it("flags a public table with no GRANT", () => {
    const out = lintBackendQuality([mig(`create table public.notes (id uuid primary key);`)]);
    expect(has(out, /no GRANT/)).toBe(true);
  });

  it("accepts a granted table", () => {
    const out = lintBackendQuality([
      mig(`create table public.notes (id uuid primary key);
grant select, insert on public.notes to authenticated;
grant all on public.notes to service_role;`),
    ]);
    expect(has(out, /no GRANT/)).toBe(false);
  });

  it("flags roles stored on the profile row", () => {
    const out = lintBackendQuality([
      mig(`create table public.profiles (id uuid primary key, role text default 'user');
grant select on public.profiles to authenticated;`),
    ]);
    expect(has(out, /privilege-escalation/)).toBe(true);
  });

  it("flags destructive DDL", () => {
    const out = lintBackendQuality([mig(`drop table public.notes;`)]);
    expect(has(out, /DROP TABLE/)).toBe(true);
  });

  it("flags an anon read policy on a sensitive table", () => {
    const out = lintBackendQuality([
      mig(`create table public.payments (id uuid primary key);
grant select on public.payments to anon;
create policy "read" on public.payments for select to anon using (true);`),
    ]);
    expect(has(out, /unrestricted read/)).toBe(true);
  });

  it("flags an insert policy with no WITH CHECK", () => {
    const out = lintBackendQuality([
      mig(`create table public.notes (id uuid);
grant insert on public.notes to authenticated;
create policy "ins" on public.notes for insert to authenticated;`),
    ]);
    expect(has(out, /WITH CHECK/)).toBe(true);
  });

  it("flags a service-role key in client code", () => {
    const out = lintBackendQuality([
      { path: "src/lib/db.ts", content: `const k = SUPABASE_SERVICE_ROLE_KEY;` },
    ]);
    expect(has(out, /service-role key/)).toBe(true);
  });

  it("ignores secrets in server-only modules", () => {
    const out = lintBackendQuality([
      { path: "src/server/db.server.ts", content: `process.env.SUPABASE_SERVICE_ROLE_KEY` },
    ]);
    expect(out).toHaveLength(0);
  });

  it("flags a mutating server function with no validator", () => {
    const out = lintBackendQuality([
      {
        path: "src/lib/x.functions.ts",
        content: `export const a = createServerFn({ method: "POST" }).handler(async () => 1);`,
      },
    ]);
    expect(has(out, /inputValidator/)).toBe(true);
  });
});
