/**
 * Guaranteed memory — the "never forget" rules:
 *
 * 1. When the 30-key cap trims, facts are merged into the `notes` digest
 *    instead of being deleted.
 * 2. The digest is bounded and deduped; the newest facts never fall off.
 * 3. The writer is instructed to record stable facts, not to stay silent.
 * 4. Remembered `dont_do` / `must_have` rules are enforced by the edit
 *    audit — broken ones surface as violations, with the user's current
 *    request overriding memory.
 */
import { describe, expect, it } from "vitest";
import {
  MEMORY_WRITER_SYSTEM,
  mergeNotesDigest,
  planTrim,
} from "@/server/project-memory.server";
import { auditChangeSet } from "@/server/edit-audit.server";
import type { ChangeSet } from "@/server/change-set.server";

function changeSet(items: string[], preserve: string[] = []): ChangeSet {
  return {
    items: items.map((text, i) => ({
      id: i + 1,
      text,
      target: null,
      kind: "visual" as const,
      keywords: text.toLowerCase().split(/\s+/).filter((w) => w.length >= 4),
    })),
    preserve: preserve.map((text) => ({ text, target: null })),
    multi: items.length > 1,
  };
}

describe("planTrim — nothing is ever deleted", () => {
  it("does nothing under the cap", () => {
    const rows = [
      { id: "1", key: "tone", value: "playful" },
      { id: "2", key: "name", value: "Bloom" },
    ];
    expect(planTrim(rows, 30)).toEqual({ deleteIds: [], notesUpsert: null });
  });

  it("merges overflow facts into the notes digest instead of dropping them", () => {
    const rows = Array.from({ length: 32 }, (_, i) => ({
      id: `r${i}`,
      key: `fact_${i}`,
      value: `value ${i}`,
    }));
    const { deleteIds, notesUpsert } = planTrim(rows, 30);
    // 32 rows, keep 29 + notes slot → 3 trimmed.
    expect(deleteIds).toEqual(["r29", "r30", "r31"]);
    expect(notesUpsert).toContain("fact_29: value 29");
    expect(notesUpsert).toContain("fact_31: value 31");
  });

  it("extends an existing digest without duplicating it", () => {
    const rows = [
      { id: "n", key: "notes", value: "old: thing" },
      ...Array.from({ length: 31 }, (_, i) => ({
        id: `r${i}`,
        key: `fact_${i}`,
        value: `value ${i}`,
      })),
    ];
    const { notesUpsert } = planTrim(rows, 30);
    expect(notesUpsert).toContain("old: thing");
    expect(notesUpsert).toContain("fact_30: value 30");
  });
});

describe("mergeNotesDigest", () => {
  it("dedupes and keeps the newest facts when over the cap", () => {
    const long = mergeNotesDigest(
      "a: 1; b: 2",
      ["a: 1", ...Array.from({ length: 80 }, (_, i) => `k${i}: ${"x".repeat(20)}`)],
    );
    expect(long.length).toBeLessThanOrEqual(2000);
    expect(long).toContain("k0:");
  });
});

describe("memory writer instructions", () => {
  it("tells the writer to record stable facts, not to stay silent", () => {
    expect(MEMORY_WRITER_SYSTEM).toMatch(/record ANY stable fact/i);
    expect(MEMORY_WRITER_SYSTEM).not.toMatch(/empty plan is a great answer/i);
  });
});

describe("auditChangeSet — remembered rules are enforced", () => {
  const before = [{ path: "src/App.tsx", content: "const brand = 'forest green';" }];

  it("flags a dont_do rule broken by lines added this turn", () => {
    const after = [{ path: "src/App.tsx", content: "const brand = 'purple';" }];
    const audit = auditChangeSet({
      changeSet: changeSet(["change the brand colour"]),
      before,
      after,
      memory: [{ key: "dont_do", value: "never use purple" }],
    });
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0].preserve.text).toContain("never to");
  });

  it("does not flag a token the user explicitly asked for this turn", () => {
    const after = [{ path: "src/App.tsx", content: "const brand = 'purple';" }];
    const audit = auditChangeSet({
      changeSet: changeSet(["actually, make the brand purple"]),
      before,
      after,
      memory: [{ key: "dont_do", value: "never use purple" }],
    });
    expect(audit.violations).toHaveLength(0);
  });

  it("flags a must_have that the turn removed", () => {
    const after = [{ path: "src/App.tsx", content: "const brand = 'teal';" }];
    const audit = auditChangeSet({
      changeSet: changeSet(["change the brand colour"]),
      before,
      after,
      memory: [{ key: "must_have", value: "always keep the forest green brand colour" }],
    });
    expect(audit.violations.some((v) => v.preserve.text.includes("must-have"))).toBe(true);
  });

  it("ignores an untouched must_have", () => {
    const after = [
      { path: "src/App.tsx", content: "const brand = 'forest green';\n// footer tweak" },
    ];
    const audit = auditChangeSet({
      changeSet: changeSet(["tweak the footer"]),
      before,
      after,
      memory: [{ key: "must_have", value: "always keep the forest green brand colour" }],
    });
    expect(audit.violations).toHaveLength(0);
  });
});
