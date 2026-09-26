import { describe, expect, it } from "vitest";
import { undefinedNames, safeReactImportRepair } from "@/server/engine/work-unit";
import { checkUndefinedIdentifiers } from "@/server/verification/identifiers.server";
import { runAgentLoop as writePlannedPages } from "@/server/engine/agent-loop";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { retirementFor, checkpointUsable, checkpointSeedFiles } from "@/server/build-checkpoint.server";

const frame = { path: "src/App.tsx", content: 'import P from "@/pages/Prescriptions";\n<Routes><Route/></Routes> nav footer' };
const reactBug = 'export default function P(){ const [a] = React.useState(1); return <div>{a}</div> }';

describe("per-unit used-but-undefined check", () => {
  it("names file, symbol, line and reason", () => {
    const d = undefinedNames({ path: "src/pages/X.tsx", content: "export default function X(){ return <div>{fooBar}</div> }" }, [], checkUndefinedIdentifiers);
    expect(d[0]).toMatchObject({ path: "src/pages/X.tsx", name: "fooBar", line: 1 });
    expect(d[0]!.message).toContain("declared nowhere");
  });
  it("React namespace use is repaired mechanically, nothing else is", () => {
    const f = { path: "src/pages/P.tsx", content: reactBug };
    const d = undefinedNames(f, [], checkUndefinedIdentifiers);
    const r = safeReactImportRepair(f, d, true)!;
    expect(r.content.startsWith('import React from "react";')).toBe(true);
    expect(undefinedNames(r, [], checkUndefinedIdentifiers)).toEqual([]);
    expect(safeReactImportRepair(f, [{ ...d[0]!, name: "useState" }], true)).toBeNull();
    expect(safeReactImportRepair(f, d, false)).toBeNull();
  });
  it("Prescriptions React mistake is caught inside the page unit, no model call", async () => {
    const asked: string[] = [];
    const r = await writePlannedPages({
      pages: [{ route: "/prescriptions", file: "src/pages/Prescriptions.tsx" }],
      files: [frame], budget: new RecoveryBudget(), checkIdentifiers: checkUndefinedIdentifiers,
      request: async (i) => { asked.push(i); return [{ path: "src/pages/Prescriptions.tsx", content: reactBug }]; },
    });
    expect(asked.filter((a) => a.includes("page ONLY")).length).toBe(1);
    expect(r.files.find((f) => f.path === "src/pages/Prescriptions.tsx")!.content).toContain('import React from "react"');
    expect(r.units.find((u) => u.kind === "page")!.outcome).toBe("corrected");
  });
  it("other undefined names go back to the same writer once with the exact diagnostic", async () => {
    const asked: string[] = [];
    const r = await writePlannedPages({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }],
      files: [frame], budget: new RecoveryBudget(), checkIdentifiers: checkUndefinedIdentifiers,
      request: async (i) => { asked.push(i); const fixed = i.includes("`patientCount` is used but declared nowhere");
        return [{ path: "src/pages/Home.tsx", content: `export default function Home(){ ${fixed ? "const patientCount = 3;" : ""} return <p>{patientCount}</p> }` }]; },
    });
    expect(asked.filter((a) => a.includes("page ONLY")).length).toBe(2);
    expect(r.units.find((u) => u.kind === "page")!.outcome).toBe("corrected");
  });
});

describe("checkpoint lifecycle", () => {
  it("success consumes; failures/cancel close with outcome; provider loss stays resumable", () => {
    expect(retirementFor("committed")).toEqual({ status: "consumed", terminal_outcome: "committed" });
    expect(retirementFor("verification_failed")).toEqual({ status: "discarded", terminal_outcome: "verification_failed" });
    expect(retirementFor("cancelled")!.status).toBe("discarded");
    expect(retirementFor("resumable")).toBeNull();
    expect(retirementFor("worker_lost")).toBeNull();
  });
  it("revision mismatch and stale shell are not resumable", () => {
    const shell = { name: null, args: "{}", text: "", finishReason: null };
    expect(checkpointUsable({ shell, base_revision: 3 }, 4)).toMatchObject({ ok: false });
    expect(checkpointUsable({ shell: null, base_revision: 3 }, 3)).toMatchObject({ ok: false });
    expect(checkpointUsable({ shell, base_revision: 3 }, 3)).toEqual({ ok: true });
  });
  it("resume re-stages completed work and never rewrites it", async () => {
    const seeded = checkpointSeedFiles({ pages: { "src/pages/Done.tsx": "export default function D(){return <main>done page with real content here</main>}" } }, [frame]);
    const asked: string[] = [];
    const r = await writePlannedPages({ pages: [{ route: "/d", file: "src/pages/Done.tsx" }], files: seeded, budget: new RecoveryBudget(), request: async (i) => { asked.push(i); return []; } });
    expect(asked.filter((a) => a.includes("page ONLY")).length).toBe(0);
    expect(r.units[0]!.outcome).toBe("skipped_done");
  });
});
