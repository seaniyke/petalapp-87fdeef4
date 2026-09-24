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
    expect(i).toContain("WRITE SCOPE: exactly one file, src/pages/Home.tsx");
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
