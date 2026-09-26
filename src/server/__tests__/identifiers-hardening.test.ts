/**
 * Hardening of the semantic (undefined-identifier) gate and of partial
 * completion: explicit verified / failed / unavailable outcomes, checking of
 * the PROPOSED tree, no false positives on legitimate code, and blocked
 * parts of a request keeping the requirement open.
 */
import { describe, expect, it } from "vitest";
import { checkUndefinedIdentifiers } from "@/server/verification/identifiers.server";
import { verifyProposedSource } from "@/server/verification/source.server";
import { classifyRequest } from "@/server/execution/classify";
import { evaluateRequirements, type PrdRequirement, type RequirementEvidence } from "@/server/prd/prd-requirements";

const pkg = { path: "package.json", content: JSON.stringify({ dependencies: { react: "18" } }) };
const file = (path: string, content: string) => ({ path, content });

describe("explicit outcomes", () => {
  it("verified when the checker ran clean", () => {
    const r = checkUndefinedIdentifiers([pkg, file("src/a.tsx", "export const a = 1;\n")], ["src/a.tsx"]);
    expect(r.status).toBe("verified");
  });

  it("failed when an undeclared name is proven", () => {
    const r = checkUndefinedIdentifiers([pkg, file("src/a.tsx", "export const a = mode;\n")], ["src/a.tsx"]);
    expect(r.status).toBe("failed");
    expect(r.issues[0]!.message).toContain("mode");
  });

  it("unavailable (never verified) when the time budget is exceeded", () => {
    let t = 0;
    const r = checkUndefinedIdentifiers([pkg, file("src/a.tsx", "export const a = 1;\n")], ["src/a.tsx"], { budgetMs: 5, now: () => (t += 10) });
    expect(r.status).toBe("unavailable");
    expect(r.reason).toMatch(/exceeded/);
  });

  it("unavailable when a changed file is not in the tree it was asked to check", () => {
    const r = checkUndefinedIdentifiers([pkg], ["src/ghost.tsx"]);
    expect(r.status).toBe("unavailable");
  });

  it("source verification carries the semantic status and never labels unavailable as verified", async () => {
    const ok = await verifyProposedSource({ tree: [pkg, file("src/a.tsx", "export const a = 1;\n")], changedPaths: ["src/a.tsx"], requestedRoutes: [] });
    expect(ok.semantic.status).toBe("verified");
    const bad = await verifyProposedSource({ tree: [pkg, file("src/a.tsx", "export const a = mode;\n")], changedPaths: ["src/a.tsx"], requestedRoutes: [] });
    expect(bad.semantic.status).toBe("failed");
    expect(bad.status).toBe("FAILED");
  });
});

describe("checks the proposed tree", () => {
  it("sees a proposed export from another changed file (named import resolves)", () => {
    const tree = [
      pkg,
      file("src/lib/auth.ts", "export function signIn() { return 1; }\n"),
      file("src/pages/Auth.tsx", `import { signIn } from "../lib/auth";\nexport default function A() { return <button onClick={() => signIn()}>Go</button>; }\n`),
    ];
    expect(checkUndefinedIdentifiers(tree, ["src/lib/auth.ts", "src/pages/Auth.tsx"]).status).toBe("verified");
  });

  it("judges the proposed bytes, not an older version of the same file", () => {
    // Only the proposed tree is passed; the checker has no access to a persisted copy.
    const proposed = [pkg, file("src/pages/Auth.tsx", "export default function A() { return <p>{mode}</p>; }\n")];
    expect(checkUndefinedIdentifiers(proposed, ["src/pages/Auth.tsx"]).status).toBe("failed");
  });

  it("untouched broken files do not fail a turn that didn't change them", () => {
    const tree = [pkg, file("src/old.tsx", "export const x = nope;\n"), file("src/new.tsx", "export const y = 1;\n")];
    expect(checkUndefinedIdentifiers(tree, ["src/new.tsx"]).status).toBe("verified");
  });
});

describe("no false positives on legitimate code", () => {
  const legit = `import React, { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
type Props = { title: string; items: string[] };
export default function Page({ title, items }: Props) {
  const [{ count }, setState] = useState({ count: 0 });
  const [first, ...rest] = items;
  useEffect(() => {
    const io = new IntersectionObserver(() => {});
    const ro = new ResizeObserver(() => {});
    const copy = structuredClone({ a: 1 });
    console.log(window.location.href, document.title, navigator.userAgent, copy);
    fetch("/api").then((r) => r.json());
    return () => { io.disconnect(); ro.disconnect(); };
  }, []);
  function handle(e: React.MouseEvent<HTMLButtonElement>, n: number) { setState({ count: count + n }); }
  return <main><h1>{title}</h1><Link to="/">{first}</Link>{rest.map((r) => <span key={r}>{r}</span>)}<button onClick={(e) => handle(e, 1)}>+</button></main>;
}
`;
  it("accepts globals, JSX, imports, locals, params, destructuring and browser APIs", () => {
    const r = checkUndefinedIdentifiers([pkg, file("src/pages/Page.tsx", legit)], ["src/pages/Page.tsx"]);
    expect(r).toEqual({ status: "verified", issues: [] });
  });

  it("still rejects a genuine undeclared identifier in the same file", () => {
    const r = checkUndefinedIdentifiers([pkg, file("src/pages/Page.tsx", legit.replace("{title}</h1>", "{title}{subtitle}</h1>"))], ["src/pages/Page.tsx"]);
    expect(r.status).toBe("failed");
    expect(r.issues.map((i) => i.message).join(" ")).toContain("subtitle");
  });
});

describe("App.tsx partial completion stays open", () => {
  const now = "2026-09-25T00:00:00.000Z";
  const auth: PrdRequirement = {
    id: "auth", description: "Customer accounts", category: "feature", status: "NOT_STARTED",
    dependsOn: [], evidence: [], lastVerifiedRevision: null, updatedAt: now, nextAction: "Add customer accounts",
  };
  const files = [{ path: "src/pages/Auth.tsx", hash: "h1" }, { path: "src/App.tsx", hash: "h2" }];
  const ev = (rev: number, extra: Partial<RequirementEvidence> = {}): RequirementEvidence => ({
    projectRevision: rev, files, routes: ["/auth"], build: null, configuredIntegrations: [], ...extra,
  });

  it("a turn whose App.tsx change was blocked leaves accounts IN_PROGRESS with the owed file recorded", () => {
    const [r] = evaluateRequirements([auth], ev(5, { turn: { brief: "I want people to create account", changedPaths: ["src/pages/Auth.tsx"], blockedPaths: ["src/App.tsx"] } }), now);
    expect(r!.status).toBe("IN_PROGRESS");
    expect(r!.pendingPaths).toEqual(["src/App.tsx"]);
    expect(r!.evidence.join(" ")).toContain("Still owed: src/App.tsx");
  });

  it("a later verified build of the same revision cannot mark it COMPLETED while App.tsx is owed", () => {
    const [afterTurn] = evaluateRequirements([auth], ev(5, { turn: { brief: "create account", changedPaths: ["src/pages/Auth.tsx"], blockedPaths: ["src/App.tsx"] } }), now);
    const [afterBuild] = evaluateRequirements([afterTurn!], ev(5, { build: { revision: 5, status: "ready", verified: true } }), now);
    expect(afterBuild!.status).toBe("IN_PROGRESS");
    expect(afterBuild!.pendingPaths).toEqual(["src/App.tsx"]);
  });

  it("the next turn that actually changes App.tsx clears it, then the verified build completes it — no restated request", () => {
    const [owed] = evaluateRequirements([auth], ev(5, { turn: { brief: "create account", changedPaths: ["src/pages/Auth.tsx"], blockedPaths: ["src/App.tsx"] } }), now);
    const [fixed] = evaluateRequirements([owed!], ev(6, { turn: { brief: "Fix the preview error", changedPaths: ["src/App.tsx"], blockedPaths: [] } }), now);
    expect(fixed!.pendingPaths).toBeUndefined();
    const [done] = evaluateRequirements([fixed!], ev(6, { build: { revision: 6, status: "ready", verified: true } }), now);
    expect(done!.status).toBe("COMPLETED");
  });

  it("is idempotent on unchanged state", () => {
    const [a] = evaluateRequirements([auth], ev(5, { turn: { brief: "create account", changedPaths: ["src/pages/Auth.tsx"], blockedPaths: ["src/App.tsx"] } }), now);
    const [b] = evaluateRequirements([a!], ev(5), now);
    expect(b).toBe(a);
  });
});

describe("planning is not suppressed by repair words", () => {
  it("localized bug → targeted repair", () => {
    const c = classifyRequest("The sign-in button on the Auth page throws an error", { isInitial: false });
    expect(c.operation).toBe("repair");
    expect(c.planRequired).toBe(false);
  });

  it("broad product request → planning retained", () => {
    const c = classifyRequest("Rework the whole app: add accounts, bookings, an admin dashboard and payments across every page", { isInitial: false });
    expect(c.planRequired).toBe(true);
  });

  it("broad request containing 'broken' / 'fix' / 'problem' still plans", () => {
    for (const p of [
      "Everything is broken — restructure the whole app's navigation and data flow across all pages",
      "Fix the problem across the entire app: rebuild routing and shared layout for every page",
    ]) {
      const c = classifyRequest(p, { isInitial: false });
      expect(c.planRequired, p).toBe(true);
    }
  });

  it("repair context never becomes first_build", () => {
    const c = classifyRequest("Fix this runtime error: ReferenceError: mode is not defined in src/pages/Auth.tsx", { isInitial: false });
    expect(c.operation).not.toBe("first_build");
  });
});

describe("type-only undefined names", () => {
  it("does not fail on a type used only in annotations", () => {
    const r = checkUndefinedIdentifiers([pkg, file("src/c.tsx", "export function C({ a }: TaskCardProps) { return a as unknown; }\n")], ["src/c.tsx"]);
    expect(r.status).toBe("verified");
  });
  it("still fails on a runtime name", () => {
    const r = checkUndefinedIdentifiers([pkg, file("src/d.tsx", "export function D(p: Props) { return helper(p); }\n")], ["src/d.tsx"]);
    expect(r.status).toBe("failed");
    expect(r.issues.map((i) => i.message).join()).toMatch(/helper/);
    expect(r.issues.map((i) => i.message).join()).not.toMatch(/Props/);
  });
});
