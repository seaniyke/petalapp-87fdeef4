/**
 * Phase 7 — the ten acceptance cases for editing an existing app.
 *
 * Each case is the behaviour a user would judge us on, expressed against the
 * real modules the live pipeline uses (no mocks, no model calls):
 *   extractChangeSet → resolveWithFocus → (edit happens) → auditChangeSet.
 *
 * `applyEdit` below stands in for the coding model: it writes the files a
 * correct (or deliberately incomplete) edit would write, so the audit is
 * exercised on real before/after file sets.
 */

import { describe, it, expect } from "vitest";
import { extractChangeSet, renderChangeSetBlock, kitTargetGuidance } from "@/server/change-set.server";
import { auditChangeSet, unmetDisclosure } from "@/server/edit-audit.server";
import { resolveWithFocus, focusFromTurn, isTopicChange, type EditFocus } from "@/server/edit-focus.server";
import type { ProjectFile } from "@/server/generate.server";

const app = (): ProjectFile[] => [
  {
    path: "src/components/Hero.tsx",
    content: `export default function Hero() {
  return (
    <section className="bg-slate-900 py-24">
      <h1 className="text-5xl">Ship faster</h1>
      <button className="bg-blue-600">Get started</button>
    </section>
  );
}`,
  },
  {
    path: "src/components/Navbar.tsx",
    content: `export default function Navbar() {
  return <nav className="h-16 bg-slate-900">Acme</nav>;
}`,
  },
  {
    path: "src/components/Footer.tsx",
    content: `export default function Footer() {
  return <footer className="py-8">© Acme</footer>;
}`,
  },
  {
    path: "src/routes/pricing.tsx",
    content: `export default function Pricing() {
  return <div className="grid grid-cols-3">Plans</div>;
}`,
  },
  {
    path: "src/routes/contact.tsx",
    content: `export default function Contact() {
  return <form><input name="email" /></form>;
}`,
  },
];

/** Stand-in for the coding model: rewrite the named files with added text. */
function applyEdit(
  before: ProjectFile[],
  edits: Array<{ path: string; add: string }>,
): ProjectFile[] {
  return before.map((f) => {
    const e = edits.find((x) => x.path === f.path);
    return e ? { ...f, content: `${f.content}\n// ${e.add}` } : f;
  });
}

function run(prompt: string, edits: Array<{ path: string; add: string }>) {
  const changeSet = extractChangeSet(prompt);
  const before = app();
  const after = applyEdit(before, edits);
  return { changeSet, audit: auditChangeSet({ changeSet, before, after }) };
}

describe("acceptance 1 — a single change lands", () => {
  it("records one item and sees it met", () => {
    const { changeSet, audit } = run("make the hero background lighter", [
      { path: "src/components/Hero.tsx", add: "hero background lighter" },
    ]);
    expect(changeSet.items).toHaveLength(1);
    expect(changeSet.items[0]!.target).toBe("hero");
    expect(audit.unmet).toHaveLength(0);
  });
});

describe("acceptance 2 — several changes in one message all land", () => {
  it("splits the clauses and marks each met", () => {
    const { changeSet, audit } = run(
      "make the hero background lighter, shrink the navbar and add a phone number to the footer",
      [
        { path: "src/components/Hero.tsx", add: "hero background lighter" },
        { path: "src/components/Navbar.tsx", add: "navbar shorter" },
        { path: "src/components/Footer.tsx", add: "footer phone number" },
      ],
    );
    expect(changeSet.multi).toBe(true);
    expect(changeSet.items.length).toBeGreaterThanOrEqual(3);
    expect(audit.unmet).toHaveLength(0);
  });

  it("flags the parts that did not land instead of claiming success", () => {
    const { audit } = run(
      "make the hero background lighter, shrink the navbar and add a phone number to the footer",
      [{ path: "src/components/Hero.tsx", add: "hero background lighter" }],
    );
    expect(audit.unmet.length).toBeGreaterThan(0);
    const note = unmetDisclosure(audit.unmet, audit.violations);
    expect(note).toMatch(/didn't land yet/);
    expect(note.toLowerCase()).toContain("navbar");
  });
});

describe("acceptance 3 — a global change is understood as global", () => {
  it("does not pin a single surface for an app-wide ask", () => {
    const { changeSet } = run("make the whole app feel more premium", []);
    expect(changeSet.items).toHaveLength(1);
    expect(changeSet.items[0]!.target === null || changeSet.items[0]!.target === "app").toBe(true);
  });
});

describe("acceptance 4 — a local change stays local", () => {
  it("targets only the named surface", () => {
    const { changeSet, audit } = run("only change the pricing cards spacing", [
      { path: "src/routes/pricing.tsx", add: "pricing cards spacing" },
    ]);
    expect(changeSet.items[0]!.target).toMatch(/pricing/);
    expect(audit.changedPaths).toEqual(["src/routes/pricing.tsx"]);
  });
});

describe("acceptance 5 — preservation is recorded and enforced", () => {
  it("captures a don't-change constraint", () => {
    const cs = extractChangeSet("restyle the hero but keep the footer exactly as it is");
    expect(cs.preserve.length).toBeGreaterThan(0);
    expect(cs.preserve.some((p) => (p.target ?? p.text).toLowerCase().includes("footer"))).toBe(true);
  });

  it("reports a violation when the preserved surface is touched", () => {
    const { audit } = run("restyle the hero but keep the footer exactly as it is", [
      { path: "src/components/Hero.tsx", add: "hero restyle" },
      { path: "src/components/Footer.tsx", add: "oops" },
    ]);
    expect(audit.violations.length).toBeGreaterThan(0);
    expect(unmetDisclosure(audit.unmet, audit.violations)).toMatch(/leave alone/);
  });

  it("stays quiet when the preserved surface is untouched", () => {
    const { audit } = run("restyle the hero but keep the footer exactly as it is", [
      { path: "src/components/Hero.tsx", add: "hero restyle" },
    ]);
    expect(audit.violations).toHaveLength(0);
  });
});

describe("acceptance 6 — a multi-layer feature is one request, not one file", () => {
  it("treats a data-shaped ask as data work", () => {
    const cs = extractChangeSet("let visitors book a table and save the booking to the database");
    expect(cs.items.some((i) => i.kind === "data")).toBe(true);
  });
});

describe("acceptance 7 — a follow-up resolves against the last edit", () => {
  it('"make the button white too" means the hero button', () => {
    const prev = extractChangeSet("make the hero background lighter");
    const focus = focusFromTurn({
      changeSet: prev,
      changedPaths: ["src/components/Hero.tsx"],
    });
    expect(focus).not.toBeNull();

    const cs = extractChangeSet("make the button white too");
    const res = resolveWithFocus({ prompt: "make the button white too", changeSet: cs, focus });
    expect(res.applied).toBe(true);
    expect(res.pinnedPaths).toContain("src/components/Hero.tsx");
    expect(res.block).toMatch(/hero/i);
  });
});

describe("acceptance 8 — a new subject is not hijacked by the old one", () => {
  it('"now fix the contact form" moves on from the hero', () => {
    const focus: EditFocus = {
      target: "hero",
      paths: ["src/components/Hero.tsx"],
      at: Date.now(),
    };
    const prompt = "now fix the contact form";
    const cs = extractChangeSet(prompt);
    expect(isTopicChange(prompt, cs, focus)).toBe(true);
    expect(resolveWithFocus({ prompt, changeSet: cs, focus }).applied).toBe(false);
  });

  it("stale focus expires rather than misleading the next edit", () => {
    const stale: EditFocus = {
      target: "hero",
      paths: ["src/components/Hero.tsx"],
      at: Date.now() - 3 * 60 * 60 * 1000,
    };
    const prompt = "make the button white too";
    const cs = extractChangeSet(prompt);
    expect(resolveWithFocus({ prompt, changeSet: cs, focus: stale }).applied).toBe(false);
  });
});

describe("acceptance 9 — a broad design ask is a single change, not many", () => {
  it("does not explode a design sentence into unrelated items", () => {
    const cs = extractChangeSet("make the landing page feel more premium and modern");
    expect(cs.items.length).toBeLessThanOrEqual(2);
    expect(cs.items[0]!.kind).toBe("visual");
  });
});

describe("acceptance 10 — four unrelated changes in one message", () => {
  it("all four are tracked and checked", () => {
    const prompt =
      "change the hero headline to Build in minutes, make the navbar sticky, " +
      "add an FAQ to the pricing page and make the contact form send an email";
    const { changeSet, audit } = run(prompt, [
      { path: "src/components/Hero.tsx", add: "Build in minutes headline" },
      { path: "src/components/Navbar.tsx", add: "navbar sticky" },
      { path: "src/routes/pricing.tsx", add: "pricing faq" },
      { path: "src/routes/contact.tsx", add: "contact form email" },
    ]);
    expect(changeSet.items.length).toBeGreaterThanOrEqual(4);
    expect(audit.unmet).toHaveLength(0);
  });

  it("a turn that changed nothing at all is never reported as done", () => {
    const prompt =
      "change the hero headline, make the navbar sticky, add an FAQ and send contact emails";
    const { audit } = run(prompt, []);
    expect(audit.met).toHaveLength(0);
    expect(audit.unmet.length).toBeGreaterThanOrEqual(1);
  });
});

describe("the checklist reaches the model", () => {
  it("renders every requested change plus the must-not-change list", () => {
    const cs = extractChangeSet(
      "make the hero darker and shrink the navbar but don't change the footer",
    );
    const block = renderChangeSetBlock(cs);
    expect(block).toMatch(/REQUESTED CHANGES/);
    expect(block).toMatch(/MUST NOT CHANGE/);
    expect(block.toLowerCase()).toContain("navbar");
  });
});

describe("root-cause fixes found by the live run", () => {
  it("a phone number in the footer is content work, not a screen-size tweak", () => {
    const cs = extractChangeSet("add a phone number to the footer");
    expect(cs.items[0]!.kind).not.toBe("responsive");
  });

  it("still treats a real screen-size ask as responsive", () => {
    const cs = extractChangeSet("fix the hero on mobile");
    expect(cs.items[0]!.kind).toBe("responsive");
  });

  it("tells the model where to change a surface that lives in a Petal-owned component", () => {
    const cs = extractChangeSet("shrink the navbar");
    const files = [
      { path: "src/components/blocks/nav-bar.tsx", content: "export function NavBar() {}" },
      { path: "src/App.tsx", content: 'import { NavBar } from "@/components/blocks/nav-bar";' },
    ];
    const block = kitTargetGuidance(cs, files);
    expect(block).toMatch(/nav-bar/);
    expect(block).toMatch(/src\/App\.tsx/);
  });

  it("says nothing when the target is ordinary app code", () => {
    const cs = extractChangeSet("shrink the navbar");
    expect(kitTargetGuidance(cs, [{ path: "src/pages/Home.tsx", content: "<nav />" }])).toBe("");
  });
});

describe("audit sees a change made at a component's call site", () => {
  it("counts a navbar tweak applied as a prop on <NavBar", () => {
    const cs = extractChangeSet("shrink the navbar so it is less tall");
    const before = [{ path: "src/App.tsx", content: '<NavBar\n  brand={x}\n/>' }];
    const after = [{ path: "src/App.tsx", content: '<NavBar\n  brand={x}\n  className="py-0"\n/>' }];
    const res = auditChangeSet({ changeSet: cs, before, after });
    expect(res.unmet).toHaveLength(0);
  });
});
