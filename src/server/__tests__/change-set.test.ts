import { describe, expect, it } from "vitest";
import { extractChangeSet, renderChangeSetBlock } from "@/server/change-set.server";
import { auditChangeSet } from "@/server/edit-audit.server";

describe("extractChangeSet", () => {
  it("keeps every clause of a multi-part edit", () => {
    const cs = extractChangeSet(
      "Make the hero darker, change the headline, replace the illustration and make the CTA larger",
    );
    expect(cs.multi).toBe(true);
    expect(cs.items.length).toBeGreaterThanOrEqual(4);
    const targets = cs.items.map((i) => i.target);
    expect(targets).toContain("hero");
    expect(targets).toContain("headline");
    expect(targets).toContain("cta");
  });

  it("treats a single edit as one item", () => {
    const cs = extractChangeSet("Make the hero background darker");
    expect(cs.items).toHaveLength(1);
    expect(cs.multi).toBe(false);
    expect(cs.items[0]!.target).toBe("hero");
  });

  it("records negative requirements as preservation, not changes", () => {
    const cs = extractChangeSet("Make the hero darker but don't change the text");
    expect(cs.items.some((i) => i.target === "hero")).toBe(true);
    expect(cs.preserve.length).toBe(1);
    expect(cs.preserve[0]!.text).toMatch(/don'?t change the text/i);
  });

  it("classifies backend-shaped asks as data work", () => {
    const cs = extractChangeSet("Make the booking form actually save the booking to the database");
    expect(cs.items[0]!.kind).toBe("data");
  });

  it("renders a numbered checklist with preservation rules", () => {
    const cs = extractChangeSet(
      "Redesign the dashboard and fix the logout button, but keep the current navigation",
    );
    const block = renderChangeSetBlock(cs);
    expect(block).toContain("REQUESTED CHANGES");
    expect(block).toContain("MUST NOT CHANGE");
  });
});

describe("auditChangeSet", () => {
  const before = [
    { path: "src/components/Hero.tsx", content: "export const Hero = () => <div>old</div>;\n" },
    { path: "src/components/Navbar.tsx", content: "export const Navbar = () => <nav/>;\n" },
  ];

  it("marks a change met when the diff shows its target", () => {
    const after = [
      {
        path: "src/components/Hero.tsx",
        content: "export const Hero = () => <div className='bg-slate-950'>new</div>;\n",
      },
      before[1]!,
    ];
    const cs = extractChangeSet("Make the hero darker");
    const audit = auditChangeSet({ changeSet: cs, before, after });
    expect(audit.unmet).toHaveLength(0);
    expect(audit.changedPaths).toEqual(["src/components/Hero.tsx"]);
  });

  it("flags the clause that never landed", () => {
    const after = [
      { path: "src/components/Hero.tsx", content: "export const Hero = () => <div>dark</div>;\n" },
      before[1]!,
    ];
    const cs = extractChangeSet("Make the hero darker and make the navbar smaller");
    const audit = auditChangeSet({ changeSet: cs, before, after });
    expect(audit.unmet.length).toBe(1);
    expect(audit.unmet[0]!.target).toBe("navbar");
  });

  it("treats a turn that changed nothing as entirely unmet", () => {
    const cs = extractChangeSet("Make the hero darker");
    const audit = auditChangeSet({ changeSet: cs, before, after: before });
    expect(audit.unmet).toHaveLength(1);
  });

  it("reports a preservation violation", () => {
    const after = [
      before[0]!,
      { path: "src/components/Navbar.tsx", content: "export const Navbar = () => <nav>x</nav>;\n" },
    ];
    const cs = extractChangeSet("Make the hero darker but don't change the navbar");
    const audit = auditChangeSet({ changeSet: cs, before, after });
    expect(audit.violations.length).toBe(1);
    expect(audit.violations[0]!.paths).toContain("src/components/Navbar.tsx");
  });
});
