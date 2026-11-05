import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { revisionAwareBuildSnapshot, newerRevision, STALE_BUILD_LABEL } from "@/lib/build-revision";

type Snap = { buildId: string; status: "pending" | "building" | "ready" | "failed"; projectRevision: number | null; verification: { ok: boolean; defects: string[] } | null; errorMessage: string | null; progressLabel: string | null };
const snap = (buildId: string, rev: number | null, status: Snap["status"], ok = true): Snap => ({
  buildId, status, projectRevision: rev, verification: status === "ready" ? { ok, defects: [] } : null,
  errorMessage: status === "failed" ? "boom" : null, progressLabel: null,
});
const shown = (s: Snap | null, rev: number | null) => revisionAwareBuildSnapshot(s, rev)?.status ?? null;

describe("stale readiness in the builder UI", () => {
  it("A–I: rev5 ready → edit → rev6 never ready from rev5 → rev6 build verified → ready", () => {
    let rev = 5; let build = snap("b5", 5, "ready");
    expect(shown(build, rev)).toBe("ready"); // A
    rev = newerRevision(rev, 6)!; // B,C committed revision from save response
    expect(shown(build, rev)).toBe("pending"); // D,E
    expect(revisionAwareBuildSnapshot(build, rev)?.verification).toBeNull();
    expect(revisionAwareBuildSnapshot(build, rev)?.progressLabel).toBe(STALE_BUILD_LABEL);
    build = snap("b5", 5, "ready"); // F late rev5 finish
    expect(shown(build, rev)).toBe("pending"); // G
    build = snap("b6", 6, "building");
    expect(shown(build, rev)).toBe("building");
    build = snap("b6", 6, "ready"); // H
    expect(shown(build, rev)).toBe("ready"); // I
  });
  it("undo/restore creates a new revision and invalidates ready", () => {
    expect(shown(snap("b20", 20, "ready"), 21)).toBe("pending");
  });
  it("failed build for current revision shows failure; stale failure does not", () => {
    expect(shown(snap("b6", 6, "failed"), 6)).toBe("failed");
    expect(shown(snap("b5", 5, "failed"), 6)).toBe("pending");
  });
  it("cancelled generation (no committed revision) keeps current ready", () => {
    expect(newerRevision(5, null)).toBe(5);
    expect(shown(snap("b5", 5, "ready"), 5)).toBe("ready");
  });
  it("stale callback / older payload cannot lower the revision", () => {
    expect(newerRevision(7, 6)).toBe(7);
    expect(shown(snap("b6", 6, "ready"), newerRevision(7, 6))).toBe("pending");
  });
  it("rapid consecutive edits: only the newest revision's build can be ready", () => {
    let rev = 5; for (const r of [6, 7, 8]) rev = newerRevision(rev, r)!;
    for (const r of [5, 6, 7]) expect(shown(snap(`b${r}`, r, "ready"), rev)).toBe("pending");
    expect(shown(snap("b8", 8, "ready"), rev)).toBe("ready");
  });
  it("two builds completing out of order", () => {
    const rev = 8;
    expect(shown(snap("b8", 8, "ready"), rev)).toBe("ready");
    expect(shown(snap("b7", 7, "ready"), rev)).toBe("pending");
  });
  it("legacy build without a revision is never ready", () => {
    expect(shown(snap("old", null, "ready"), 1)).toBe("pending");
  });
});
