import { describe, expect, it } from "vitest";
import { TurnLedger, commitTurn, isAdditiveChromeEdit, preservesBaseline } from "@/server/execution";
import { promptPriority } from "@/server/context/prompt-priority";

const css = Array.from({ length: 20 }, (_, i) => `.c${i} { color: red; }`).join("\n");
const page = "export default function About() {\n  return <main>About</main>;\n}\n";
const nav = ["export function Navbar() {", "  return (", "    <nav>", '      <a href="/">Home</a>', "    </nav>", "  );", "}"].join("\n");
const base = [
  { path: "src/styles.css", content: css },
  { path: "src/pages/About.tsx", content: page },
  { path: "src/components/Navbar.tsx", content: nav },
];
const ok = async () => ({ status: "IN_PROGRESS" as const, gates: [], failedGate: null, reason: null, repairTargets: [] });

function run(proposed: typeof base, read: string[], protectedPaths: string[] = []) {
  const ledger = new TurnLedger();
  for (const p of read) ledger.recordRead(p);
  return commitTurn({
    baseline: base,
    proposed,
    ledger,
    isSystemPath: () => false,
    protectionReason: (p) => (protectedPaths.includes(p) ? "out of scope" : null),
    checks: [],
    cancelled: () => false,
    verifySource: ok as never,
    permitDespiteProtection: isAdditiveChromeEdit,
  });
}

describe("stylesheet and layout files are sent first", () => {
  it("styles.css outranks a pinned, unrelated widget", () => {
    expect(promptPriority("src/styles.css", { target: false, pinned: false, relevant: false }))
      .toBeLessThan(promptPriority("src/components/motion/blur-fade.tsx", { target: false, pinned: true, relevant: false }));
  });
  it("edit targets stay first", () => {
    expect(promptPriority("src/pages/About.tsx", { target: true, pinned: false, relevant: false })).toBe(0);
  });
});

describe("unseen files", () => {
  it("an edit that keeps the existing stylesheet lands even if it was not in view", async () => {
    const r = await run([...base.slice(1), { path: "src/styles.css", content: `${css}\n.wide { max-width: 1200px; }` }], ["src/pages/About.tsx"]);
    expect(r.outcome.status).toBe("committed");
  });
  it("a blind rewrite of an unseen file is dropped, the rest still lands", async () => {
    const r = await run(
      [{ path: "src/styles.css", content: "body{}" }, { path: "src/pages/About.tsx", content: page.replace("About<", "About us<") }, base[2]!],
      ["src/pages/About.tsx"],
    );
    expect(r.outcome.status).toBe("committed");
    expect(r.discarded.map((d) => d.path)).toEqual(["src/styles.css"]);
    if (r.outcome.status === "committed") expect(r.outcome.files.find((f) => f.path === "src/styles.css")?.content).toBe(css);
  });
  it("preservesBaseline refuses a near-total rewrite", () => {
    expect(preservesBaseline(css, "body{}")).toBe(false);
  });
});

describe("protected files", () => {
  it("adding a link to protected navigation is allowed", async () => {
    const withLink = nav.replace('<a href="/">Home</a>', '<a href="/">Home</a>\n      <a href="/book">Book</a>');
    const r = await run([base[0]!, base[1]!, { path: "src/components/Navbar.tsx", content: withLink }], base.map((f) => f.path), ["src/components/Navbar.tsx"]);
    expect(r.outcome.status).toBe("committed");
    expect(r.discarded).toEqual([]);
  });
  it("rewriting protected navigation is held back without cancelling the page change", async () => {
    const r = await run(
      [base[0]!, { path: "src/pages/About.tsx", content: page.replace("About<", "About us<") }, { path: "src/components/Navbar.tsx", content: "export function Navbar(){return null}" }],
      base.map((f) => f.path),
      ["src/components/Navbar.tsx"],
    );
    expect(r.outcome.status).toBe("committed");
    expect(r.discarded.map((d) => d.path)).toEqual(["src/components/Navbar.tsx"]);
  });
  it("when every change is held back the turn reports it instead of claiming success", async () => {
    const r = await run([base[0]!, base[1]!, { path: "src/components/Navbar.tsx", content: "x" }], base.map((f) => f.path), ["src/components/Navbar.tsx"]);
    expect(r.outcome.status).toBe("rolled_back");
    expect(r.rejections[0]?.reason).toBe("scope_violation");
  });
});
