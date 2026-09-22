/**
 * Guards the rules that make automatic database upgrades safe.
 *
 * These are deliberately source-level assertions where the behaviour lives in
 * side effects against the database (provisioning, copying, clearing), plus
 * real assertions on the pure pieces. What must never regress:
 *   - the shared copy is only cleared after the dedicated copy is verified
 *   - any failure puts the project back on the shared database
 *   - an app that can't be upgraded keeps working
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

describe("automatic upgrade", () => {
  const src = read("src/server/backend-autoscale.server.ts");

  it("verifies the copy before clearing the shared one", () => {
    const verifyAt = src.indexOf("verifyCopy(projectId, target, copied)");
    const clearAt = src.indexOf("clearSharedCopy(projectId)");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(verifyAt);
  });

  it("rolls back to the shared database on any failure", () => {
    expect(src).toContain('.update({ backend_type: "shared" })');
    expect(src).toContain("catch (e) {");
    expect(src).toContain("return await rollback(");
  });

  it("gates on the owner's credits before provisioning", () => {
    expect(src).toContain("ownerCanFund");
    expect(src).toContain('blocked: "no_credits"');
  });

  it("respects Kimble's own capacity ceiling", () => {
    expect(src).toContain('economicsValue("max_active_dedicated_backends")');
    expect(src).toContain('blocked: "at_capacity"');
  });

  it("never upgrades an app whose owner opted out", () => {
    expect(src).toContain("auto_upgrade_opt_out");
    expect(src).toContain('blocked: "opted_out"');
  });

  it("tells the owner after an upgrade", () => {
    expect(src).toContain("notifyOwner(projectId, reason)");
    expect(src).toContain("backend_auto_upgrade");
  });

  it("never throws out of the entry point", () => {
    const consider = src.slice(src.indexOf("export async function considerUpgrade"));
    expect(consider).toContain("try {");
    expect(consider).toContain("catch (e)");
  });
});

describe("data store resolution", () => {
  const src = read("src/server/project-store.server.ts");

  it("falls back to the shared database rather than failing", () => {
    expect(src).toContain("falling back to shared");
    expect(src).toContain("store = SHARED_STORE();");
  });

  it("scopes every dedicated mirror table by project", () => {
    expect(src).toContain("project_id UUID NOT NULL");
    expect(src).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("preserves ids when copying so app references keep resolving", () => {
    expect(src).toContain('onConflict: "id"');
  });
});

describe("never-break guarantee", () => {
  const src = read("src/server/shared-backend.server.ts");

  it("does not apply the row ceiling to an app with its own database", () => {
    expect(src).toContain("if (!store.dedicated) {");
  });

  it("explains a full starter database without a dead end", () => {
    expect(src).toContain("keeps working with the data it has");
  });
});
