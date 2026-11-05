import { describe, it, expect, vi } from "vitest";
import { buildGenerationUnits, safeUnitBudget } from "@/server/requested-scope";
import { bufferedResponse } from "@/server/ai-provider.server";
import { runWriteGate } from "@/server/write-gate.server";
import { runScopedBuildCleanup } from "@/server/build-cleanup-scope.server";

const PROMPT =
  "Build a website for Rise & Crumb, an artisan bakery and café. Pages: Home, Menu, About, Contact. Responsive, polished and accessible, with imagery, tasteful motion, clear navigation, a footer, and a working contact form. Do not add any other pages or features.";

describe("planner fits the real output budget", () => {
  it("never plans a unit above the safe budget derived from a 10,000 ceiling", () => {
    const u = buildGenerationUnits(PROMPT, [], { maxOutputTokens: 10_000 });
    expect(u.safeBudget).toBeLessThanOrEqual(10_000);
    for (const unit of u.units) expect(unit.estimatedTokens).toBeLessThanOrEqual(u.safeBudget);
    expect(u.units.some((x) => x.estimatedTokens === 10_500)).toBe(false);
    expect(u.unitCount).toBeGreaterThan(1); // still batched, not one page per call
    expect(u.unitCount).toBeLessThan(4);
  });
  it("safe budget leaves headroom", () => {
    expect(safeUnitBudget(10_000)).toBe(8_000);
    expect(safeUnitBudget(18_000)).toBe(11_000);
  });
});

describe("body read fix", () => {
  it("buffered response can be read by the caller after usage is read", async () => {
    const r = await bufferedResponse(new Response(JSON.stringify({ usage: { prompt_tokens: 1 }, ok: 1 })));
    await r.clone().text();
    expect(((await r.json()) as { ok: number }).ok).toBe(1);
  });
  it("unreadable body becomes a clean failure response", async () => {
    const bad = new Response("x");
    await bad.text();
    const r = await bufferedResponse(bad);
    expect(r.ok === false || r.bodyUsed === false).toBe(true);
  });
});

const good = (name: string) => `export default function ${name}() { return <main>${name}</main>; }\n`;
const broken = `export default function Contact() { return <main>{"a", "b"</main>; }\n`;

describe("broken requested page is repaired, not dropped", () => {
  const after = [
    { path: "src/pages/Home.tsx", content: good("Home") },
    { path: "src/pages/Menu.tsx", content: good("Menu") },
    { path: "src/pages/Contact.tsx", content: broken },
  ];
  const changed = after.map((f) => f.path);
  it("detects, repairs only the broken file, preserves completed pages", async () => {
    const repair = vi.fn(async () => good("Contact"));
    const g = await runWriteGate({ before: [], after, changedPaths: changed, repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect((repair.mock.calls[0] as unknown as [{ path: string }])[0].path).toBe("src/pages/Contact.tsx");
    expect(g.repairedPaths).toEqual(["src/pages/Contact.tsx"]);
    expect(g.rejected).toEqual([]);
    expect(g.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toBe(good("Home"));
    expect(g.files.find((f) => f.path === "src/pages/Menu.tsx")!.content).toBe(good("Menu"));
    expect(g.files.find((f) => f.path === "src/pages/Contact.tsx")!.content).toBe(good("Contact"));
  });
  it("failed repair is reported truthfully, bounded to one attempt", async () => {
    const repair = vi.fn(async () => broken + " ");
    const g = await runWriteGate({ before: [], after, changedPaths: changed, repair });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(g.rejected.map((r) => r.path)).toEqual(["src/pages/Contact.tsx"]);
    expect(g.repairFailedPaths).toEqual(["src/pages/Contact.tsx"]);
  });
});

describe("cleanup stays restricted to changed files", () => {
  it("untouched starter files are never modified", async () => {
    const files = [
      { path: "src/components/ui/button.tsx", content: "export const x = 1\n" },
      { path: "src/pages/Home.tsx", content: good("Home") },
    ];
    const r = await runScopedBuildCleanup(files, ["src/pages/Home.tsx"], { turnId: "t" });
    expect(r.scope).toEqual(["src/pages/Home.tsx"]);
    expect(r.files.find((f) => f.path === "src/components/ui/button.tsx")!.content).toBe("export const x = 1\n");
  });
});
