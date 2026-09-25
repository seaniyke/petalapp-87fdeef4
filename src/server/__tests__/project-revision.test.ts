import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { buildRevisionStatus, isRevisionConflict, staleReasonText } from "@/lib/build-revision";
import { runAgentOps, type AgentOpsStore, type TurnRow } from "@/server/agent-ops.server";

const read = (p: string) => readFileSync(p, "utf8");
const gen = read("src/routes/api/generate.ts");
const callback = read("src/routes/api/public/builds/callback.ts");
const trigger = read("src/routes/api/builds/trigger.ts");
const retry = read("src/server/build-retry.server.ts");
const publish = read("src/routes/api/publish.ts");
const migration = readdirSync("supabase/migrations")
  .map((f) => read(`supabase/migrations/${f}`))
  .find((s) => s.includes("bump_revision_on_file_insert") && s.includes("replace_project_files"))!;

describe("revision storage + initialization (A, U, V)", () => {
  it("one NOT NULL project code revision; existing and new projects start at 1", () => {
    expect(migration).toMatch(/ALTER TABLE public\.projects ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1/);
  });
  it("builds record their revision; legacy builds stay NULL (unknown), never backfilled", () => {
    expect(migration).toMatch(/project_builds ADD COLUMN IF NOT EXISTS project_revision bigint;/);
    expect(migration).not.toMatch(/UPDATE public\.project_builds/);
  });
  it("project_intelligence.revision is untouched and separate", () => {
    expect(migration).not.toMatch(/project_intelligence/);
  });
});

describe("atomic save + increment rules (B–G, M)", () => {
  it("files, revision and turn.committed_revision change in one function, under a row lock", () => {
    const fn = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.replace_project_files"));
    expect(fn).toMatch(/FROM public\.projects WHERE id = _project_id FOR UPDATE/);
    expect(fn).toMatch(/IF NOT _changed THEN\s+RETURN _current;/); // no-op → unchanged
    expect(fn).toMatch(/SET revision = revision \+ 1/);
    expect(fn).toMatch(/UPDATE public\.turns SET committed_revision = _current/);
    expect(fn).toMatch(/revision_conflict/); // concurrent commit against an old base is rejected
    expect(fn.indexOf("revision_conflict")).toBeLessThan(fn.indexOf("DELETE FROM public.project_files"));
  });
  it("generation saves only a committed transaction, before billing, bound to the turn", () => {
    expect(gen).toMatch(/if \(!\(body\.projectId && txCommitted && nextFiles\.length > 0\)\) return;/);
    expect(gen).toMatch(/replaceFiles\(body\.projectId, Array\.from\(byPath\.values\(\)\), \{ turnId:/);
    const persist = gen.indexOf("await persistCommitted();");
    expect(persist).toBeGreaterThan(0);
    expect(persist).toBeLessThan(gen.indexOf("agentIO().settleCharge("));
    expect(gen).toMatch(/if \(persistError\) \{\s*console\.warn\(`\[credits\] turn not billed: save failed/);
  });
  it("a failed save leaves the previous files and reports failure (no charge, no memory)", () => {
    expect(gen).toMatch(/nextFiles = turnBaselineFiles;/);
    expect(gen).toMatch(/committed: txSaved,/);
    expect(gen).toMatch(/!!persistError \|\|/);
  });
  it("recognises the conflict error", () => {
    expect(isRevisionConflict("revision_conflict: project is at revision 19 but …")).toBe(true);
    expect(isRevisionConflict("Not authorized")).toBe(false);
  });
});

describe("gateway save is bound to the turn and returns the revision", () => {
  it("files.replace passes the turn id and reports the new revision", async () => {
    const T = "11111111-1111-4111-8111-111111111111";
    const turns: TurnRow[] = [{ id: T, user_id: "u", project_id: "p", status: "running", committed_at: "now" } as TurnRow];
    let seen: string | undefined;
    const store = {
      getTurn: async () => ({ ...turns[0]! }),
      replaceFiles: async (_p: string, _f: unknown, turnId?: string) => ((seen = turnId), 19),
    } as unknown as AgentOpsStore;
    const [r] = await runAgentOps(store, T, [{ op: "files.replace", files: [{ path: "a.ts", content: "1" }] }]);
    expect(seen).toBe(T);
    expect(r).toMatchObject({ ok: true, data: { revision: 19 } });
  });
  it("a rejected save is a failed op, not a success", async () => {
    const T = "11111111-1111-4111-8111-111111111111";
    const store = {
      getTurn: async () => ({ id: T, user_id: "u", project_id: "p", status: "running", committed_at: "now" }),
      replaceFiles: async () => {
        throw new Error("revision_conflict: x");
      },
    } as unknown as AgentOpsStore;
    const [r] = await runAgentOps(store, T, [{ op: "files.replace", files: [{ path: "a.ts", content: "1" }] }]);
    expect(r).toMatchObject({ ok: false });
  });
});

describe("builds bind to a revision (H, I, J, L, O, W)", () => {
  it("current build matches; older and legacy builds do not", () => {
    expect(buildRevisionStatus({ project_revision: 18 }, { revision: 18 })).toEqual({ current: true });
    const old = buildRevisionStatus({ project_revision: 18 }, { revision: 19 });
    expect(old).toMatchObject({ current: false, reason: "superseded" });
    const legacy = buildRevisionStatus({ project_revision: null }, { revision: 1 });
    expect(legacy).toMatchObject({ current: false, reason: "legacy_unknown_revision" });
    if (!old.current) expect(staleReasonText(old)).toMatch(/revision 18.*revision 19/);
  });
  it("trigger captures the revision with the files it packs and reuses only same-revision builds", () => {
    expect(trigger).toMatch(/readFilesAtRevision\(projectId\)/);
    expect(trigger).toMatch(/project_revision: projectRevision/);
    expect(trigger).toMatch(/sameRevision/);
    expect(trigger).not.toMatch(/newestFileWrite/); // no timestamp inference
  });
  it("callback rejects stale results before any readiness/pointer/outcome/repair work", () => {
    const gate = callback.indexOf("buildRevisionStatus(existing, proj)");
    expect(gate).toBeGreaterThan(0);
    for (const later of ["latest_build_id: payload.buildId", "runTestLabForBuild(", "recordBuildOutcome({", "classifyBuildFailure(message)", "retryStalledBuild("]) {
      expect(callback.indexOf(later)).toBeGreaterThan(gate);
    }
    expect(callback).toMatch(/stale_reason: reason/);
  });
  it("the current-build pointer is a compare-and-set on the revision", () => {
    expect(callback).toMatch(/\.eq\("revision", Number\(existing\.project_revision\)\)/);
  });
  it("a runtime verdict finishing after the project moved on cannot establish readiness (K, W)", () => {
    const recheck = callback.indexOf("stale runtime verdict ignored");
    expect(recheck).toBeGreaterThan(callback.indexOf("runTestLabForBuild("));
    expect(recheck).toBeLessThan(callback.lastIndexOf("readiness,\n"));
  });
  it("retry of the same revision keeps it; a moved-on project refuses the retry (O)", () => {
    expect(retry).not.toMatch(/revision\s*\+\s*1/);
    expect(retry).toMatch(/outcome: "superseded"/);
    expect(retry).toMatch(/adoptCurrentRevision/);
    expect(callback).toMatch(/source: "callback-missing-dep", adoptCurrentRevision: true/);
  });
});

describe("publish (S, T)", () => {
  it("pinning requires the latest build to be of the current revision, as a CAS", () => {
    expect(publish).toMatch(/buildRevisionStatus\(build, project\)/);
    expect(publish).toMatch(/if \(pinLatestBuild\) publishQuery = publishQuery\.eq\("revision"/);
  });
  it("visibility changes never touch revision or unpublish because of it", () => {
    expect(publish).not.toMatch(/published_build_id = null;[\s\S]{0,80}revision/);
  });
});

describe("non-generation writes (N, P, Q, R)", () => {
  it("every full-tree save (editor, quick edit, revert/restore) goes through the revision-bumping RPC", () => {
    expect(read("src/lib/projects.ts")).toMatch(/"replace_project_files"/);
  });
  it("direct file writes advance the revision per statement only when content changed", () => {
    expect(migration).toMatch(/n\.content IS DISTINCT FROM o\.content/);
    expect(migration).toMatch(/AFTER INSERT ON public\.project_files/);
    expect(migration).toMatch(/AFTER DELETE ON public\.project_files/);
  });
  it("non-code state (title, memory, visibility) has no revision trigger", () => {
    expect(migration).not.toMatch(/ON public\.projects\b.*FOR EACH/);
    expect(migration).not.toMatch(/project_memory/);
  });
});
