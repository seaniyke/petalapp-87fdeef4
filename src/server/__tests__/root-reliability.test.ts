import { describe, expect, it, vi } from "vitest";
import { writePlannedPages } from "@/server/engine/write";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import {
  isOwnContentIssue,
  isTruncationDetail,
  isolateBrokenFiles,
  turnOutcomeStatus,
} from "@/server/engine/build-state";
import { repairBrokenFile } from "@/server/engine/repair";
import { decideBuildStatus, publishOutcome } from "@/lib/build-status";
import { partitionVerificationDefects } from "@/lib/verification-report";

const pages = [
  { route: "/", file: "src/pages/Home.tsx" },
  { route: "/menu", file: "src/pages/Menu.tsx" },
  { route: "/about", file: "src/pages/About.tsx" },
  { route: "/contact", file: "src/pages/Contact.tsx" },
];
const frame = {
  path: "src/App.tsx",
  content:
    'import {Routes,Route} from "x";export default function App(){return <div><header><nav/></header><Routes><Route path="/"/><Route path="/menu"/><Route path="/about"/><Route path="/contact"/></Routes><footer/></div>}',
};
const good = (path: string) => ({ path, content: `export default function P(){return <main>${path}</main>}` });
const CUT = "export default function Home(){return <main><h1>Rise";
const isTruncated = async (f: { content: string }) => f.content === CUT;

function requester(homeAttempts: string[]) {
  const counts: Record<string, number> = {};
  const request = vi.fn(async (instruction: string) => {
    const file = /as (src\/pages\/[^\s]+\.tsx)/.exec(instruction)?.[1];
    if (!file) return [frame];
    counts[file] = (counts[file] ?? 0) + 1;
    if (file === "src/pages/Home.tsx") {
      const next = homeAttempts.shift() ?? CUT;
      return [{ path: file, content: next }];
    }
    return [good(file)];
  });
  return { request, counts };
}

describe("truncated file handling", () => {
  it("A: truncated Home → regenerated once → valid Home kept", async () => {
    const { request, counts } = requester([CUT, good("src/pages/Home.tsx").content]);
    const r = await writePlannedPages({ pages, files: [frame], budget: new RecoveryBudget(), request, isTruncated });
    expect(counts["src/pages/Home.tsx"]).toBe(2);
    expect(r.missing).toEqual([]);
    expect(r.truncated).toEqual(["src/pages/Home.tsx"]);
  });

  it("B: regeneration also truncated → Home isolated, others intact", async () => {
    const { request, counts } = requester([CUT, CUT]);
    const r = await writePlannedPages({ pages, files: [frame], budget: new RecoveryBudget(), request, isTruncated });
    expect(counts["src/pages/Home.tsx"]).toBe(2);
    expect(r.missing).toEqual(["/"]);
    for (const p of ["src/pages/Menu.tsx", "src/pages/About.tsx", "src/pages/Contact.tsx", "src/App.tsx"]) {
      expect(r.files.some((f) => f.path === p)).toBe(true);
    }
    expect(r.files.some((f) => f.content === CUT)).toBe(false);
  });

  it("C: valid pages are never regenerated because another was truncated", async () => {
    const { request, counts } = requester([CUT, CUT]);
    await writePlannedPages({ pages, files: [frame], budget: new RecoveryBudget(), request, isTruncated });
    expect(counts["src/pages/Menu.tsx"]).toBe(1);
    expect(counts["src/pages/About.tsx"]).toBe(1);
    expect(counts["src/pages/Contact.tsx"]).toBe(1);
  });

  it("D: truncation is its own class — detected structurally, never patched", async () => {
    expect(isTruncationDetail('Unexpected end of file before a closing "main" tag')).toBe(true);
    expect(isTruncationDetail("Unterminated string literal")).toBe(true);
    expect(isTruncationDetail('Expected ";" but found "x"')).toBe(false);
    // repair refuses without calling any provider
    expect(await repairBrokenFile({ path: "a.tsx", content: CUT }, "Unexpected end of file")).toBeNull();
  });

  it("E: a broken file never rolls back valid files; dependents stay", () => {
    const files = [frame, good("src/pages/Menu.tsx"), { path: "src/pages/Home.tsx", content: CUT }];
    const kept = isolateBrokenFiles(files, ["src/pages/Home.tsx"]);
    expect(kept.map((f) => f.path)).toEqual(["src/App.tsx", "src/pages/Menu.tsx"]);
    // App.tsx importing the isolated Home is a dependency issue, not own-content
    expect(isOwnContentIssue("missing-sibling")).toBe(false);
    expect(isOwnContentIssue("missing-export")).toBe(false);
    expect(isOwnContentIssue("parse")).toBe(true);
  });
});

describe("authoritative build state", () => {
  const base = { built: true, deployProbeOk: true, blockingDefects: [], blockingIsEdgeNoiseOnly: false, hasPlaceholderFiles: false };
  it("browser failure → not ready", () => {
    expect(decideBuildStatus({ ...base, blockingDefects: ["Route / rendered a blank page"] }).status).toBe("failed");
  });
  it("build failure → not ready", () => {
    expect(decideBuildStatus({ ...base, built: false }).status).toBe("failed");
  });
  it("incomplete generation → not ready", () => {
    expect(decideBuildStatus({ ...base, hasPlaceholderFiles: true }).status).toBe("failed");
  });
  it("probe failure → not ready", () => {
    expect(decideBuildStatus({ ...base, deployProbeOk: false }).status).toBe("failed");
  });
  it("successful browser verification → ready", () => {
    expect(decideBuildStatus(base).status).toBe("ready");
  });
  it("published only from ready; failed publish is not published", () => {
    expect(publishOutcome("ready", true)).toBe("published");
    expect(publishOutcome("ready", false)).toBe("ready");
    expect(publishOutcome("failed", true)).toBe("not_publishable");
  });
  it("the last run's stand-in screen finding is blocking, not cosmetic", () => {
    const d =
      'Visual QA (blank) — entire page: The page renders only the placeholder text "Coming together / This section is being assembled."';
    expect(partitionVerificationDefects([d]).blocking).toEqual([d]);
    expect(partitionVerificationDefects(["Visual QA (spacing) — hero is tight"]).blocking).toEqual([]);
  });
});

describe("final done status derives from the turn outcome", () => {
  const block = (o: string, reason?: string) =>
    `data: ${JSON.stringify({ type: "turn_outcome", outcome: o, changedPaths: [], ...(reason ? { reason } : {}) })}\n\n`;
  it.each([
    ["no files", block("blocked", "no_files"), "failed"],
    ["partial files", block("failed", "requested_scope_missing"), "failed"],
    ["broken file isolated (incomplete)", block("failed", "requested_scope_missing"), "failed"],
    ["reverted", block("failed", "final_check_reverted"), "failed"],
    ["successful build", block("applied"), "succeeded"],
    ["answered", block("answered"), "succeeded"],
    ["unknown outcome fails closed", block("weird"), "failed"],
  ])("%s", (_n, b, want) => {
    expect(turnOutcomeStatus(b)).toBe(want);
  });
  it("non-outcome blocks carry no status", () => {
    expect(turnOutcomeStatus('data: {"type":"status"}\n\n')).toBeNull();
  });
});

describe("audit consolidation", () => {
  it("one AI repair per file across the whole turn (write-time + final check share it)", () => {
    const b = new RecoveryBudget();
    expect(b.take("broken_file", "src/pages/Home.tsx")).toBe(true);
    expect(b.take("broken_file", "src/pages/Home.tsx")).toBe(false);
  });

  it("clean-up that breaks an already-valid/repaired file is put back, not repaired or set aside", async () => {
    const { revertCleanupBreakage } = await import("@/server/write-gate.server");
    const before = [good("src/pages/Home.tsx"), good("src/pages/Menu.tsx")];
    const after = [{ path: "src/pages/Home.tsx", content: "export default function P(){return <main>" }, good("src/pages/Menu.tsx")];
    const out = await revertCleanupBreakage(before, after, ["src/pages/Home.tsx", "src/pages/Menu.tsx"]);
    expect(out.reverted).toEqual(["src/pages/Home.tsx"]);
    expect(out.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toBe(before[0].content);
    expect(out.files.find((f) => f.path === "src/pages/Menu.tsx")!.content).toBe(before[1].content);
  });

  it("clean-up leaves valid changes alone", async () => {
    const { revertCleanupBreakage } = await import("@/server/write-gate.server");
    const before = [good("src/pages/About.tsx")];
    const after = [{ path: "src/pages/About.tsx", content: 'export default function P(){return <main className="p-4">x</main>}' }];
    const out = await revertCleanupBreakage(before, after, ["src/pages/About.tsx"]);
    expect(out.reverted).toEqual([]);
    expect(out.files).toEqual(after);
  });

  it("live site not responding goes through the single decision → failed", () => {
    const d = decideBuildStatus({ built: true, deployProbeOk: false, blockingDefects: [], blockingIsEdgeNoiseOnly: false, hasPlaceholderFiles: false });
    expect(d.status).toBe("failed");
  });

  it("broken Home or broken router never drops the other pages", () => {
    const all = [frame, ...pages.map((p) => good(p.file))];
    const noHome = isolateBrokenFiles(all, new Set(["src/pages/Home.tsx"]));
    expect(noHome.map((f) => f.path)).toEqual(expect.arrayContaining(["src/pages/Menu.tsx", "src/pages/About.tsx", "src/pages/Contact.tsx", "src/App.tsx"]));
    const noRouter = isolateBrokenFiles(all, new Set(["src/App.tsx"]));
    expect(noRouter.map((f) => f.path)).toEqual(expect.arrayContaining(pages.map((p) => p.file)));
  });

  it("removed steps stay removed from the build path", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/routes/api/generate.ts", "utf8");
    expect(src).not.toMatch(/enforceDesignContract/);
    expect(src).not.toMatch(/KIMBLE_PREEMIT_AGENT_LOOP|runAgentLoop/);
    const cb = fs.readFileSync("src/routes/api/public/builds/callback.ts", "utf8");
    expect(cb).toMatch(/status: probeDecision\.status/);
  });
});
