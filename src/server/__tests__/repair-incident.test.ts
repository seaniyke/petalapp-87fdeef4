/**
 * Regression tests for the "ReferenceError: mode is not defined" incident:
 * a generated Auth page referenced an identifier that was never declared,
 * esbuild (parse-only) passed it, the bytes were committed, and the preview
 * crashed. The automatic repair then ran the FIRST-BUILD stages (design
 * direction, page mapping) instead of a targeted fix.
 *
 * Covers brief §15 items A, B, C, E, I, K and the positive-escalation rule.
 */
import { describe, expect, it } from "vitest";
import { TurnLedger, commitTurn, type SourceVerification } from "@/server/execution";
import { verifyProposedSource } from "@/server/verification/source.server";
import { checkUndefinedIdentifiers } from "@/server/verification/identifiers.server";
import { classifyRequest } from "@/server/execution/classify";

const pkg = { path: "package.json", content: JSON.stringify({ dependencies: { react: "18" } }) };

const AUTH_BROKEN = `import { useState } from "react";
export default function Auth() {
  const [email, setEmail] = useState("");
  return (
    <main>
      <h1>{mode === "signin" ? "Member access" : "Join us"}</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
    </main>
  );
}
`;

const AUTH_FIXED = `import { useState } from "react";
export default function Auth() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  return (
    <main>
      <h1>{mode === "signin" ? "Member access" : "Join us"}</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>Switch</button>
    </main>
  );
}
`;

const base = [
  pkg,
  { path: "index.html", content: "<div id=root></div>" },
  { path: "src/pages/Home.tsx", content: "export default function Home() { return <main>Home page content here</main>; }\n" },
];

const withAuth = (content: string) => [...base, { path: "src/pages/Auth.tsx", content }];

const commit = (proposed: typeof base, verifySource: (t: typeof base, c: string[]) => Promise<SourceVerification>) =>
  commitTurn({
    baseline: base,
    proposed,
    ledger: (() => { const l = new TurnLedger(); for (const f of proposed) l.recordRead(f.path); return l; })(),
    isSystemPath: () => false,
    protectionReason: () => null,
    checks: [],
    cancelled: () => false,
    verifySource,
  });

describe("undefined-identifier gate (the real TypeScript checker)", () => {
  it("A: flags an identifier that is referenced but never declared", () => {
    const r = checkUndefinedIdentifiers(withAuth(AUTH_BROKEN), ["src/pages/Auth.tsx"]);
    expect(r.status).toBe("failed");
    const issues = r.issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.path).toBe("src/pages/Auth.tsx");
    expect(issues[0]!.message).toContain("mode");
  });

  it("I: passes once the state is actually declared", () => {
    const r = checkUndefinedIdentifiers(withAuth(AUTH_FIXED), ["src/pages/Auth.tsx"]);
    expect(r).toEqual({ status: "verified", issues: [] });
  });

  it("ignores DOM/platform globals and untyped JSX (no false positives)", () => {
    const page = `import { useEffect, useState } from "react";
export default function Home() {
  const [w, setW] = useState(0);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    const t = setTimeout(() => console.log("hi", document.title, localStorage.getItem("x")), 100);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, []);
  return <main><h1>Size {w}</h1><button onClick={() => fetch("/api").then((r) => r.json())}>Go</button></main>;
}
`;
    const issues = checkUndefinedIdentifiers([...base.slice(0, 2), { path: "src/pages/Home.tsx", content: page }], ["src/pages/Home.tsx"]).issues;
    expect(issues).toEqual([]);
  });

  it("only reports on files the turn changed", () => {
    // Home.tsx is broken but unchanged this turn; Auth.tsx is clean.
    const tree = [
      ...base.slice(0, 2),
      { path: "src/pages/Home.tsx", content: "export default function Home() { return <main>{nope}</main>; }\n" },
      { path: "src/pages/Auth.tsx", content: AUTH_FIXED },
    ];
    const issues = checkUndefinedIdentifiers(tree, ["src/pages/Auth.tsx"]).issues;
    expect(issues).toEqual([]);
  });

  it("B: source verification FAILS before persistence and names the file as the repair target", async () => {
    const v = await verifyProposedSource({ tree: withAuth(AUTH_BROKEN), changedPaths: ["src/pages/Auth.tsx"], requestedRoutes: [] });
    expect(v.status).toBe("FAILED");
    expect(v.failedGate).toBe("syntax");
    expect(v.repairTargets).toContain("src/pages/Auth.tsx");
    expect(v.reason).toContain("mode");
  });

  it("K: the commit boundary refuses to persist the broken file", async () => {
    const r = await commit(withAuth(AUTH_BROKEN), (t, c) => verifyProposedSource({ tree: t, changedPaths: c, requestedRoutes: [] }));
    expect(r.outcome.status).not.toBe("committed");
  });

  it("M: the fixed file verifies and commits", async () => {
    const r = await commit(withAuth(AUTH_FIXED), (t, c) => verifyProposedSource({ tree: t, changedPaths: c, requestedRoutes: [] }));
    expect(r.outcome.status).toBe("committed");
  });
});

describe("repair-turn classification (E: no first-build restart)", () => {
  const AUTO_FIX_PROMPT = [
    "The running app threw a runtime error in the preview iframe. Find and fix the cause. Make the smallest correct change.",
    "",
    "Kind: error",
    "Message: ReferenceError: mode is not defined",
    "Source: src/pages/Auth.tsx:12:34",
  ].join("\n");

  it("C/E: a preview ReferenceError classifies as a targeted repair, direct mode", () => {
    const c = classifyRequest(AUTO_FIX_PROMPT, { isInitial: false });
    expect(c.operation).toBe("repair");
    expect(c.mode).toBe("direct");
    expect(c.planRequired).toBe(false);
  });

  it("E: a build-failure auto-fix classifies as repair, never first_build", () => {
    const c = classifyRequest("The build just failed with this error from the bundler: Cannot find module './x'. Fix it.", { isInitial: false });
    expect(c.operation).toBe("repair");
    expect(c.mode).toBe("direct");
  });

  it("positive: a genuinely broad problem still escalates to staged planning", () => {
    const c = classifyRequest("Redesign the entire site — every page feels broken and nothing works", { isInitial: false });
    expect(c.operation).toBe("architectural_change");
    expect(c.mode).toBe("staged");
    expect(c.planRequired).toBe(true);
  });

  it("F: the original user request survives — repair is not first_build even with feature words present", () => {
    const c = classifyRequest("Fix the crash on the sign up page — the form submit button throws an error", { isInitial: false });
    expect(c.operation).toBe("repair");
  });
});
