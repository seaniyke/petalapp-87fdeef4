/**
 * The design-system package is the single visual authority. End-to-end over
 * the real registry, apply engine, design record, prompt blocks, lint and
 * re-theme pipeline (storage/build injected in memory).
 */
import { describe, expect, it } from "vitest";
import { getDesignSystem } from "@/server/design-systems/registry";
import { TOKENS_START, FONTS_START } from "@/server/design-systems/apply";
import { resolveDefaultPackage, applyPackageToTree, visualsFromPackage } from "@/server/design-systems/authority";
import { preserveDesignPackage, designSystemBlockFor } from "@/server/design-systems/context";
import { rethemeProject, type RethemeDeps } from "@/server/design-systems/retheme";
import { commitDesignSystem, renderDesignSystemBlock } from "@/server/design/design-system.server";
import { renderDesignDirectionBlock, fallbackDesignDirection } from "@/server/design-director.server";
import { renderDesignTasteBlock } from "@/server/design-taste.server";
import { renderAppUiBlock } from "@/server/app-ui-library.server";
import { lintDesignSystem } from "@/server/design/design-system-lint.server";
import { applyPaletteFloor } from "@/server/palette-floor.server";
import { buildRevisionStatus } from "@/lib/build-revision";
import type { PicDesignSystem, PicUnderstanding } from "@/server/pic/pic-types";
import * as fs from "node:fs";

const SLUG = "kimble-test-system";
const understanding = {
  summary: "", productType: "website", domain: "bakery", platforms: ["web"],
  surfaces: { marketing: true, application: false, admin: false }, firstVersion: [],
} as unknown as PicUnderstanding;

const scaffold = () => [
  { path: "src/styles.css", content: ":root {\n  --primary: oklch(0.55 0.18 280);\n  --background: white;\n}\n" },
  { path: "src/routes/__root.tsx", content: 'export const r = { head: () => ({ links: [{ rel: "icon", href: "/f.ico" }] }) };' },
  { path: "src/routes/index.tsx", content: "export default function I() { return <main className=\"bg-background\">Hi</main> }" },
];

async function newProjectDesign(): Promise<PicDesignSystem> {
  const committed = await commitDesignSystem({ brief: "a bakery site", understanding, direction: fallbackDesignDirection("a bakery site", "p1") });
  return preserveDesignPackage(null, committed)!;
}

describe("registry", () => {
  it("has a real installed default package", () => {
    const def = resolveDefaultPackage();
    expect(def?.pkg.meta.slug).toBe(SLUG);
    expect(def?.accent).toBe("lagoon");
  });
});

describe("A. initial generation", () => {
  it("selects package + accent, derives visuals from it, installs tokens and fonts", async () => {
    const design = await newProjectDesign();
    expect(design.package).toEqual({ systemId: SLUG, accent: "lagoon" });
    expect(design.source).toBe("package");
    const pkg = getDesignSystem(SLUG)!;
    expect(design.colors.primary.light).toBe(pkg.accents.lagoon.light.primary);
    expect(design.typography.displayFont).toBe("Sora");

    const r = applyPackageToTree(scaffold(), design);
    expect(r.applied).toBe(true);
    const css = r.files.find((f) => f.path === "src/styles.css")!.content;
    expect(css).toContain(TOKENS_START);
    expect(r.files.find((f) => f.path === "src/routes/__root.tsx")!.content).toContain(FONTS_START);
  });

  it("the AI gets DESIGN.md through exactly one visual block, never raw tokens.css", async () => {
    const design = await newProjectDesign();
    const pkg = getDesignSystem(SLUG)!;
    const block = designSystemBlockFor(design);
    expect(block).toContain("SELECTED DESIGN SYSTEM: Kimble Coastal");
    expect(block).toContain(pkg.designMd.trim().slice(0, 40));
    expect(block).toContain("Accent: lagoon");
    expect(block).not.toContain("oklch(0.975 0.006 190)");

    // No competing palette / font instructions elsewhere.
    const contract = renderDesignSystemBlock(design);
    expect(contract).not.toMatch(/oklch|Color roles|Google Fonts/);
    const dir = renderDesignDirectionBlock(fallbackDesignDirection("a bakery site", "p1"), { detail: "full", packageOwnsVisuals: true });
    expect(dir).not.toMatch(/palette mood|Load both via Google Fonts/);
    expect(renderDesignTasteBlock("a bakery site", { packageOwnsVisuals: true }).text).not.toMatch(/LOCKED PALETTE/);
    expect(renderAppUiBlock("a crm", { packageOwnsVisuals: true }).text).not.toMatch(/LOCKED design tokens/);
  });
});

describe("B. normal AI edit", () => {
  it("a generation cannot replace the package, and tokens are reinstalled over AI edits", async () => {
    const design = await newProjectDesign();
    const recommitted = { ...(await commitDesignSystem({ brief: "add a menu page", understanding })), package: { systemId: "other", accent: "x" } };
    const kept = preserveDesignPackage(design, recommitted)!;
    expect(kept.package).toEqual(design.package);
    expect(kept.colors).toEqual(design.colors);

    const installed = applyPackageToTree(scaffold(), design).files;
    // AI rewrote the stylesheet and dropped the block.
    const edited = installed.map((f) => (f.path === "src/styles.css" ? { ...f, content: ":root { --primary: red; }\n" } : f));
    expect(lintDesignSystem(edited, design).findings.some((f) => f.rule === "package/tokens-block")).toBe(true);
    const restored = applyPackageToTree(edited, design);
    expect(restored.applied && restored.files.find((f) => f.path === "src/styles.css")!.content).toContain(TOKENS_START);
    // Idempotent on an already-installed tree.
    const again = applyPackageToTree(installed, design);
    expect(again.applied && again.changedPaths).toEqual([]);
  });
});

function store(design: PicDesignSystem) {
  const state = {
    files: applyPackageToTree(scaffold(), design).files,
    revision: 3, design, snapshots: 0, builds: [] as number[], charges: 0,
  };
  const deps: RethemeDeps = {
    getPackage: (s) => getDesignSystem(s),
    loadFiles: async () => state.files.map((f) => ({ ...f })),
    snapshot: async () => { state.snapshots++; },
    saveFiles: async (_p, files) => { state.files = files as typeof state.files; state.revision++; return state.revision; },
    loadDesign: async () => state.design,
    saveDesign: async (_p, d) => { state.design = d; },
    triggerBuild: async (_p, rev) => { state.builds.push(rev); },
  };
  return { state, deps };
}

describe("C. re-theme", () => {
  it("deterministic, snapshotted, new revision, build bound to it, old build stale", async () => {
    const { state, deps } = store(await newProjectDesign());
    const r = await rethemeProject(deps, { projectId: "p", systemId: SLUG, accent: "ember" });
    expect(r).toMatchObject({ ok: true, changed: true, revision: 4, built: true, changedPaths: ["src/styles.css"] });
    expect(state.snapshots).toBe(1);
    expect(state.builds).toEqual([4]);
    expect(state.design.package?.accent).toBe("ember");
    expect(state.design.colors.primary.light).toBe(getDesignSystem(SLUG)!.accents.ember.light.primary);
    expect(buildRevisionStatus({ project_revision: 3 }, { revision: state.revision }).current).toBe(false);
    expect(buildRevisionStatus({ project_revision: 4 }, { revision: state.revision }).current).toBe(true);
  });
});

describe("D. failed application", () => {
  it("no files, no revision, no selection change, no build, no charge", async () => {
    const { state, deps } = store(await newProjectDesign());
    state.files = state.files.map((f) => (f.path === "src/routes/__root.tsx" ? { ...f, content: "export {}" } : f));
    const before = JSON.stringify(state.files);
    const r = await rethemeProject(deps, { projectId: "p", systemId: SLUG, accent: "ember" });
    expect(r).toMatchObject({ ok: false, stage: "apply" });
    expect(JSON.stringify(state.files)).toBe(before);
    expect(state.revision).toBe(3);
    expect(state.design.package?.accent).toBe("lagoon");
    expect(state.builds).toEqual([]);
    expect(state.snapshots).toBe(0);
    expect(state.charges).toBe(0);
  });
});

describe("E. identical reapply", () => {
  it("changed=false, no revision, no build", async () => {
    const { state, deps } = store(await newProjectDesign());
    const r = await rethemeProject(deps, { projectId: "p", systemId: SLUG, accent: "lagoon" });
    expect(r).toMatchObject({ ok: true, changed: false, revision: null, built: false });
    expect(state.revision).toBe(3);
    expect(state.builds).toEqual([]);
  });
});

describe("legacy projects", () => {
  it("keep their look and are marked instead of silently re-themed", async () => {
    const legacy = { ...(await newProjectDesign()), source: "model" as const, colors: { ...(await newProjectDesign()).colors, primary: { light: "oklch(0.4 0.2 20)", dark: "oklch(0.6 0.2 20)" } } };
    delete (legacy as Partial<PicDesignSystem>).package;
    const next = preserveDesignPackage(legacy, await newProjectDesign())!;
    expect(next.package).toBeUndefined();
    expect(next.migration).toBe("legacy-unmapped");
    expect(next.colors.primary.light).toBe("oklch(0.4 0.2 20)");
    expect(designSystemBlockFor(next)).toBe("");
  });
});

describe("stylesheet checks understand packages", () => {
  it("package tokens pass, bypasses are still flagged, palette floor stays off", async () => {
    const design = await newProjectDesign();
    const files = applyPackageToTree(scaffold(), design).files;
    const ok = files.map((f) => (f.path === "src/routes/index.tsx" ? { ...f, content: 'export default () => <div className="bg-[var(--kimble-surface)] rounded-[var(--kimble-radius-md)]" />' } : f));
    expect(lintDesignSystem(ok, design).findings.filter((f) => f.rule.startsWith("color/") || f.rule.startsWith("package/"))).toEqual([]);
    const bad = files.map((f) => (f.path === "src/routes/index.tsx" ? { ...f, content: 'export default () => <div className="bg-indigo-500 text-[#ff0000]" />' } : f));
    const rules = lintDesignSystem(bad, design).findings.map((f) => f.rule);
    expect(rules).toContain("color/raw-utility");
    expect(rules).toContain("color/hardcoded-hex");
    const css = files.find((f) => f.path === "src/styles.css")!.content;
    expect(applyPaletteFloor(css, "bakery").changed).toBe(false);
    // Without a package the floor still guards the scaffold default.
    expect(applyPaletteFloor(scaffold()[0]!.content, "bakery").changed).toBe(true);
  });
});

describe("no legacy authority remains", () => {
  it("old theme registry and dead enforcer are gone", () => {
    expect(fs.existsSync("src/server/themes.server.ts")).toBe(false);
    expect(fs.existsSync("src/server/design/design-enforce.server.ts")).toBe(false);
    const gen = fs.readFileSync("src/routes/api/generate.ts", "utf8");
    expect(gen).toContain("applyPackageToTree(nextFiles, picContext?.design)");
    expect(gen).toContain("packageOwnsVisuals");
  });
  it("visuals come only from the package", () => {
    const v = visualsFromPackage(getDesignSystem(SLUG)!, "ember");
    expect(v.package).toEqual({ systemId: SLUG, accent: "ember" });
  });
});
