import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

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
    expect(src).toMatch(/checkpointApi\.checkpointFiles\(checkpointTurnId, \[f\]\)/);
  });
});
