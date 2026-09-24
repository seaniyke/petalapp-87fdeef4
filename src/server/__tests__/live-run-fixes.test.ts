import { describe, expect, it } from "vitest";
import { codegenProviderRouting, resolveProviderRouting } from "@/server/engine/provider-policy";
import { describeIncomplete, incompleteBuildMessage, neutraliseSuccessClaims } from "@/server/engine/build-state";
import { frameIsComplete, pageInstruction, projectContract, writePlannedPages } from "@/server/engine/write";
import { pageFileFor } from "@/server/engine/plan";
import { RecoveryBudget } from "@/server/engine/recovery-policy";
import { revertCleanupBreakage } from "@/server/write-gate.server";

const f = (path: string, content: string) => ({ path, content });

describe("provider picker is authoritative", () => {
  it("code-writing calls may only use the named upstreams (no Baidu-style fallback)", () => {
    const r = codegenProviderRouting() as { order: string[]; only: string[] };
    expect(r.only).toEqual(r.order);
    expect(r.only).toEqual(["openinference", "azure"]);
  });
  it("a turn's failed upstream is excluded from `only` too", () => {
    const r = resolveProviderRouting({ codeWriting: true, avoid: ["Azure"] }) as { only: string[] };
    expect(r.only).toEqual(["openinference"]);
  });
});

describe("truthful partial-build reporting", () => {
  const files = [
    f("src/pages/Menu.tsx", "export default function Menu(){return <main>menu</main>}"),
    f("src/pages/About.tsx", "export default function About(){return <main>about</main>}"),
    f("src/pages/Contact.tsx", "export default function Contact(){return <main>c</main>}"),
  ];
  const requested = ["/", "/menu", "/about", "/contact"];
  const state = describeIncomplete({ requestedRoutes: requested, missingRoutes: ["app shell", ...requested], files, fileFor: pageFileFor });
  it("separates created pages from pages that don't exist", () => {
    expect(state.created).toEqual(["/menu", "/about", "/contact"]);
    expect(state.notCreated).toEqual(["/"]);
    expect(state.shellMissing).toBe(true);
  });
  it("never says existing pages weren't created", () => {
    const msg = incompleteBuildMessage([], state);
    expect(msg).toContain("Menu, About and Contact were created");
    expect(msg).toContain("Home couldn't be completed");
    expect(msg).toContain("shared site layout");
    expect(msg).not.toMatch(/weren't created/);
  });
  it("no live/ready claim before build and publish", () => {
    expect(neutraliseSuccessClaims("Rise & Crumb is live — a warm site.")).not.toMatch(/is live/);
  });
});

describe("shared frame contract", () => {
  it("colours + package.json are not a frame", () => {
    expect(frameIsComplete([f("src/styles.css", ":root{}"), f("package.json", "{}")])).toBe(false);
  });
  it("an App with routes, nav and footer is", () => {
    expect(frameIsComplete([f("src/App.tsx", "<header><nav/></header><Routes><Route/></Routes><footer/>")])).toBe(true);
  });
  it("a missing frame triggers the frame call even when pages exist", async () => {
    const asked: string[] = [];
    const pages = [{ route: "/", file: "src/pages/Home.tsx" }];
    await writePlannedPages({
      pages,
      files: [f("src/pages/Home.tsx", "export default function Home(){return <main/>}")],
      budget: new RecoveryBudget(),
      request: async (i) => { asked.push(i); return null; },
    });
    expect(asked.some((i) => i.includes("SHARED FRAME"))).toBe(true);
  });
});

describe("page writer contract", () => {
  const files = [
    f("package.json", JSON.stringify({ dependencies: { react: "1", "lucide-react": "1" } })),
    f("src/components/ui/button.tsx", ""),
    f("src/components/ui/router.tsx", ""),
  ];
  it("receives the real dependency list and routing import", () => {
    const c = projectContract(files);
    expect(c).toContain("lucide-react, react");
    expect(c).toContain("@/components/ui/router");
    expect(c).toMatch(/never from "react-router-dom"/);
  });
  it("is told its write scope and that shared files are off-limits", () => {
    const i = pageInstruction({ route: "/", file: "src/pages/Home.tsx" }, [], projectContract(files), ["src/styles.css"]);
    expect(i).toContain("WRITE SCOPE: exactly one file — write the page as src/pages/Home.tsx");
    expect(i).toMatch(/do NOT recreate/);
    expect(i).toContain("src/styles.css");
  });
});

describe("cleanup can never break a file", () => {
  it("reverts a file that parsed before cleanup and fails after", async () => {
    const before = [f("src/pages/Home.tsx", "export default function Home(){return null}")];
    const after = [f("src/pages/Home.tsx", "export default function Home(){return null}}")];
    const r = await revertCleanupBreakage(before, after, ["src/pages/Home.tsx"]);
    expect(r.reverted).toEqual(["src/pages/Home.tsx"]);
    expect(r.files[0].content).toBe(before[0].content);
  });
});

import { isProviderUnavailableStatus } from "@/server/ai-provider.server";
import { runWithTurnContext, markUpstreamFailed, failedUpstreamsForTurn } from "@/server/turn-context.server";

describe("configured is not available", () => {
  it("'no provider available' and provider-level errors count as unavailable; bad output statuses don't", () => {
    for (const s of [404, 408, 502, 503, 524]) expect(isProviderUnavailableStatus(s)).toBe(true);
    for (const s of [200, 400, 401, 402]) expect(isProviderUnavailableStatus(s)).toBe(false);
  });
  it("once both primaries are unavailable, DeepInfra is the next approved upstream", async () => {
    await runWithTurnContext({ turnId: "t1" }, async () => {
      markUpstreamFailed("Azure");
      markUpstreamFailed("OpenInference");
      const r = resolveProviderRouting({ codeWriting: true, avoid: failedUpstreamsForTurn() }) as { only: string[] };
      expect(r.only).toEqual(["deepinfra"]);
    });
  });
  it("failure state is per build: a new turn starts clean", async () => {
    await runWithTurnContext({ turnId: "t2" }, async () => {
      expect(failedUpstreamsForTurn()).toEqual([]);
    });
  });
});

import { isolateBrokenFiles, outcomeFailsTurn, assessCompleteness } from "@/server/engine/build-state";

describe("first builds are never discarded wholesale", () => {
  const layout = f("src/App.tsx", `<header><nav/></header><Routes>${["/", "/menu", "/about", "/contact"].map((r) => `<Route path="${r}"/>`).join("")}</Routes><footer/>`);
  const pageFile = (n: string) => f(`src/pages/${n}.tsx`, `export default function ${n}(){return <main>${n} content</main>}`);
  const all = [layout, pageFile("Home"), pageFile("Menu"), pageFile("About"), pageFile("Contact")];
  it("3 valid pages + 1 broken page → the 3 valid pages remain", () => {
    const kept = isolateBrokenFiles(all, ["src/pages/Contact.tsx"]);
    for (const p of ["Home", "Menu", "About"]) expect(kept.some((x) => x.path === `src/pages/${p}.tsx`)).toBe(true);
    expect(kept.some((x) => x.path === "src/pages/Contact.tsx")).toBe(false);
  });
  it("valid layout + valid pages + one broken page → everything valid remains, build reported incomplete", () => {
    const kept = isolateBrokenFiles(all, ["src/pages/Menu.tsx"]);
    expect(kept.length).toBe(4);
    expect(assessCompleteness({ requestedRoutes: ["/", "/menu", "/about", "/contact"], files: kept }).complete).toBe(false);
  });
  it("all generated files broken → nothing is claimed as created, but the state is reported, not 'nothing changed'", () => {
    const kept = isolateBrokenFiles(all, all.map((x) => x.path));
    const state = describeIncomplete({ requestedRoutes: ["/", "/menu", "/about", "/contact"], missingRoutes: ["app shell", "/", "/menu", "/about", "/contact"], files: kept, fileFor: pageFileFor });
    expect(state.created).toEqual([]);
    const msg = incompleteBuildMessage([], state);
    expect(msg).toContain("couldn't be completed");
    expect(msg).not.toMatch(/nothing (was )?changed/i);
  });
  it("isolation never touches files that passed validation", () => {
    const kept = isolateBrokenFiles(all, ["src/pages/Home.tsx"]);
    for (const x of kept) expect(all.find((a) => a.path === x.path)!.content).toBe(x.content);
  });
});

describe("final done state is authoritative", () => {
  const block = (o: string, reason?: string) => `data: {"type":"turn_outcome","outcome":"${o}","changedPaths":[]${reason ? `,"reason":"${reason}"` : ""}}`;
  it("the b2/c2 scenario (final check reverted the turn) is a failure", () => {
    expect(outcomeFailsTurn(block("failed", "final_check_reverted"))).toBe(true);
  });
  it("incomplete and no-file builds are failures", () => {
    expect(outcomeFailsTurn(block("failed", "requested_scope_missing"))).toBe(true);
    expect(outcomeFailsTurn(block("blocked", "initial_generation_no_files"))).toBe(true);
  });
  it("a completed build is not", () => {
    expect(outcomeFailsTurn(block("applied"))).toBe(false);
  });
});

import { missingReachableDeps, addMissingDeps } from "@/server/engine/deps";
describe("dependency closure follows the real import graph", () => {
  const files = [
    f("package.json", JSON.stringify({ dependencies: { react: "1", "react-dom": "1" } })),
    f("src/main.tsx", 'import App from "./App";'),
    f("src/App.tsx", 'import Home from "@/pages/Home";'),
    f("src/pages/Home.tsx", 'import { SlideUp } from "@/components/motion";'),
    f("src/components/motion/index.ts", 'export * from "./slide-up";'),
    f("src/components/motion/slide-up.tsx", 'import { motion } from "framer-motion";'),
    f("src/components/ui/command.tsx", 'import { Command } from "cmdk";'),
  ];
  it("finds a kit package pulled in by a page (the live framer-motion failure)", () => {
    expect(missingReachableDeps(files)).toEqual(["framer-motion"]);
  });
  it("ignores unreachable kit files", () => {
    expect(missingReachableDeps(files)).not.toContain("cmdk");
  });
  it("only ever adds dependencies", () => {
    const out = JSON.parse(addMissingDeps(files[0]!.content, ["framer-motion"]));
    expect(out.dependencies.react).toBe("1");
    expect(out.dependencies["framer-motion"]).toBeTruthy();
  });
});
