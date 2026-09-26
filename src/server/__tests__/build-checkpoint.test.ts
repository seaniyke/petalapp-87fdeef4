import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { writePlannedPages } from "@/server/engine/write";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { checkpointSeedFiles, checkpointUsable } from "@/server/build-checkpoint.server";

// A hospital-sized first build: 6 pages, each "slow" (one model call).
const pages = ["/", "/patients", "/doctors", "/appointments", "/prescriptions", "/billing"].map((route) => ({
  route,
  file: `src/pages/${route === "/" ? "Home" : route.slice(1, 2).toUpperCase() + route.slice(2)}.tsx`,
}));
const frame = {
  path: "src/App.tsx",
  content: `import {Routes,Route} from "x";export default function App(){return <div><header><nav/></header><Routes>${pages.map((p) => `<Route path="${p.route}"/>`).join("")}</Routes><footer/></div>}`,
};
const good = (path: string) => ({ path, content: `export default function P(){return <main><h1>${path}</h1><p>Real page body for ${path}.</p></main>}` });
const CUT = "export default function Home(){return <main><h1>Rise";

describe("durable checkpoint: interrupted long build resumes, never restarts", () => {
  it("run 1 dies after 3 pages; run 2 writes only the 3 missing pages", async () => {
    const saved: Record<string, string> = {};
    const PAGE_MS = 1; // stands in for ~9 minutes of provider streaming
    let run1Calls = 0;
    let serverAlive = true;
    const run1 = vi.fn(async (instruction: string) => {
      run1Calls++;
      const file = /as (src\/pages\/[^\s]+\.tsx)/.exec(instruction)?.[1];
      await new Promise((r) => setTimeout(r, PAGE_MS));
      if (!serverAlive) throw new Error("worker lost");
      if (!file) return [frame];
      // The build server dies once the third page has landed.
      const out = [good(file)];
      if (Object.keys(saved).length >= 2) serverAlive = false;
      return out;
    });
    const r1 = await writePlannedPages({
      pages,
      files: [frame],
      budget: new RecoveryBudget(),
      request: run1,
      onFilesDone: (got) => { for (const f of got) saved[f.path] = f.content; },
    }).catch(() => null);
    expect(r1 === null || r1.missing.length > 0).toBe(true);
    const keptBeforeCrash = Object.keys(saved).filter((p) => p.startsWith("src/pages/"));
    expect(keptBeforeCrash.length).toBeGreaterThanOrEqual(3);

    // Resume from the checkpoint.
    const asked: string[] = [];
    const run2 = vi.fn(async (instruction: string) => {
      const file = /as (src\/pages\/[^\s]+\.tsx)/.exec(instruction)?.[1];
      if (file) asked.push(file);
      return file ? [good(file)] : [frame];
    });
    const seeded = checkpointSeedFiles({ pages: saved }, [frame]);
    const r2 = await writePlannedPages({ pages, files: seeded, budget: new RecoveryBudget(), request: run2 });
    expect(r2.missing).toEqual([]);
    // Never duplicates finished work: no saved page is requested again.
    for (const p of keptBeforeCrash) expect(asked).not.toContain(p);
    expect(asked.length).toBe(pages.length - keptBeforeCrash.length);
    // Saved content is exactly what shipped.
    for (const p of keptBeforeCrash) expect(r2.files.find((f) => f.path === p)?.content).toBe(saved[p]);
    console.log(`[checkpoint-test] run1 calls=${run1Calls} kept=${keptBeforeCrash.length}/${pages.length} run2 calls=${run2.mock.calls.length} (restart-from-zero would be ${pages.length})`);
  });

  it("a cut-off page is never checkpointed", async () => {
    const saved: string[] = [];
    await writePlannedPages({
      pages: pages.slice(0, 2),
      files: [frame],
      budget: new RecoveryBudget(),
      request: async (i) => {
        const file = /as (src\/pages\/[^\s]+\.tsx)/.exec(i)?.[1];
        if (!file) return [frame];
        return [{ path: file, content: file.endsWith("Home.tsx") ? CUT : good(file).content }];
      },
      isTruncated: async (f) => f.content === CUT,
      onFilesDone: (got) => saved.push(...got.map((f) => f.path)),
    });
    expect(saved).not.toContain("src/pages/Home.tsx");
    expect(saved).toContain("src/pages/Patients.tsx");
  });

  it("the shell's router is never overridden by a saved file", () => {
    const seeded = checkpointSeedFiles({ pages: { "src/App.tsx": "stale", "src/pages/Home.tsx": "x" } }, [frame]);
    expect(seeded.find((f) => f.path === "src/App.tsx")?.content).toBe(frame.content);
    expect(seeded.find((f) => f.path === "src/pages/Home.tsx")?.content).toBe("x");
  });

  it("a checkpoint is refused when the project changed since it was taken", () => {
    const shell = { name: "write_project", args: "{}", text: "", finishReason: "stop" };
    expect(checkpointUsable({ shell, base_revision: 4 }, 4).ok).toBe(true);
    expect(checkpointUsable({ shell, base_revision: 4 }, 5).ok).toBe(false);
    expect(checkpointUsable({ shell: null, base_revision: 4 }, 4).ok).toBe(false);
  });

  it("the reaper marks a lost worker with a checkpoint resumable and queues it", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir).sort().map((f) => readFileSync(`${dir}/${f}`, "utf8")).filter((s) => s.includes("build_checkpoints") && s.includes("reap_stalled_turns")).pop()!;
    expect(sql).toMatch(/SET status = 'resumable'/);
    expect(sql).toMatch(/interrupted_generation/);
    expect(sql).toMatch(/worker_lost_resumable/);
    expect(sql).toMatch(/WHERE turn_id = _turn_id AND status IN \('active','resuming'\)/);
  });

  it("generate.ts skips the shell call on resume and retires the checkpoint on commit", () => {
    const src = readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).toMatch(/directLogoEdit \|\| resumeShell \? null : await aiChatCompletions/);
    expect(src).toMatch(/markCheckpointConsumed\(checkpointTurnId\)/);
    expect(src).toMatch(/onFilesDone: checkpointTurnId/);
  });
});
