import { beforeEach, describe, expect, it, vi } from "vitest";

// Rule: publishing a project must make sure its <slug>.sites.custardai.dev
// address has a certificate (Mira Beauty went live with none → TLS failure).
const ensureCustomHostname = vi.fn();
vi.mock("@/server/cloudflare-saas.server", () => ({
  ensureCustomHostname: (h: string) => ensureCustomHostname(h),
  deleteCustomHostname: vi.fn(),
  findCustomHostnameByName: vi.fn(),
}));

const rows: Record<string, Record<string, unknown>> = {};
function chain(table: string) {
  const q: Record<string, unknown> = {};
  let isUpdate = false;
  for (const m of ["select", "eq", "neq", "in"]) q[m] = () => q;
  q.update = () => { isUpdate = true; return q; };
  q.maybeSingle = async () => ({ data: isUpdate ? { id: "p1" } : rows[table] ?? null, error: null });
  return q;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => chain(t) },
}));

describe("publish requests the address certificate", () => {
  beforeEach(() => {
    ensureCustomHostname.mockReset();
    ensureCustomHostname.mockResolvedValue({ id: "cf1" });
  });

  it("asks for the certificate of <slug>.sites.custardai.dev on publish", async () => {
    rows.projects = { id: "p1", revision: 2, latest_build_id: "b1", published_visibility: "public", subdomain: "mira-beauty-website" };
    rows.project_builds = { id: "b1", status: "ready", project_revision: 2 };
    const { publishLatestBuild } = await import("@/server/project-publish.server");
    const r = await publishLatestBuild("p1");
    expect(r.ok).toBe(true);
    expect(ensureCustomHostname).toHaveBeenCalledWith("mira-beauty-website.sites.custardai.dev");
  });

  it("still publishes when the certificate request fails", async () => {
    rows.projects = { id: "p1", revision: 2, latest_build_id: "b1", published_visibility: "public", subdomain: "mira-beauty-website" };
    rows.project_builds = { id: "b1", status: "ready", project_revision: 2 };
    ensureCustomHostname.mockRejectedValue(new Error("cloudflare down"));
    const { publishLatestBuild } = await import("@/server/project-publish.server");
    const r = await publishLatestBuild("p1");
    expect(r.ok).toBe(true);
  });
});
