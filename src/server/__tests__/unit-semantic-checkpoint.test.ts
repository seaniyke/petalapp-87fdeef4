import { describe, expect, it } from "vitest";
import { undefinedNames, safeReactImportRepair } from "@/server/engine/work-unit";
import { checkUndefinedIdentifiers } from "@/server/verification/identifiers.server";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { retirementFor, checkpointUsable, checkpointSeedFiles } from "@/server/build-checkpoint.server";

const frame = { path: "src/App.tsx", content: '<Routes><Route/></Routes> nav footer' };
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
});
