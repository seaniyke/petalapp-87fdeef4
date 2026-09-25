import { describe, expect, it } from "vitest";
import { parseDesignSystemPackage, isValidAccent, type DesignSystemPackage } from "@/server/design-systems/loader";
import { getDesignSystem, listDesignSystems, loadAllDesignSystems } from "@/server/design-systems/registry";
import { applyDesignSystem, TOKENS_START, FONTS_START } from "@/server/design-systems/apply";
import { preserveDesignPackage, renderDesignSystemContext, designSystemBlockFor } from "@/server/design-systems/context";
import { rethemeProject, type RethemeDeps } from "@/server/design-systems/retheme";
import { buildRevisionStatus } from "@/lib/build-revision";
import type { PicDesignSystem } from "@/server/pic/pic-types";

const SLUG = "kimble-test-system";
const pkg = getDesignSystem(SLUG) as DesignSystemPackage;

const baseFiles = {
  "design.json": JSON.stringify({
    schema_version: 1, slug: "demo", name: "Demo", description: "d", when_to_use: "w", version: "1.0.0",
    default_accent: "a", accents: ["a"], has_components: false,
  }),
  "tokens.css": ":root { --background: oklch(1 0 0); --kimble-radius: 4px; }",
  "accents.json": JSON.stringify({ a: { light: { primary: "oklch(0.5 0.1 20)" } } }),
  "fonts.html": '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora">',
  "DESIGN.md": "# Demo\nUse tokens.",
};

const project = () => [
  { path: "src/styles.css", content: ':root {\n  --background: white;\n}\n' },
  { path: "src/routes/__root.tsx", content: 'export const x = { head: () => ({ links: [{ rel: "icon", href: "/f.ico" }] }) };' },
  { path: "src/routes/index.tsx", content: "export default function I() { return null }" },
];

const design = (extra: Partial<PicDesignSystem> = {}) => ({ direction: "d", source: "deterministic", ...extra }) as PicDesignSystem;

describe("package loader", () => {
  it("loads a valid package", () => {
    const r = parseDesignSystemPackage(baseFiles, "demo");
    expect(r.ok).toBe(true);
  });
  it("rejects a missing required file", () => {
    const { ["fonts.html"]: _f, ...rest } = baseFiles;
    const r = parseDesignSystemPackage(rest, "demo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/fonts\.html/);
  });
  it("rejects malformed design.json", () => {
    expect(parseDesignSystemPackage({ ...baseFiles, "design.json": "{nope" }, "demo").ok).toBe(false);
    expect(parseDesignSystemPackage({ ...baseFiles, "design.json": JSON.stringify({ slug: "demo" }) }, "demo").ok).toBe(false);
  });
  it("rejects malformed accents.json and mismatched accents", () => {
    expect(parseDesignSystemPackage({ ...baseFiles, "accents.json": "[" }, "demo").ok).toBe(false);
    expect(parseDesignSystemPackage({ ...baseFiles, "accents.json": JSON.stringify({ b: { light: { primary: "x" } } }) }, "demo").ok).toBe(false);
    expect(parseDesignSystemPackage({ ...baseFiles, "accents.json": JSON.stringify({ a: { light: { primary: "x;}" } } }) }, "demo").ok).toBe(false);
  });
  it("rejects disallowed font hosts and non-link content", () => {
    expect(parseDesignSystemPackage({ ...baseFiles, "fonts.html": '<link rel="stylesheet" href="https://evil.test/x.css">' }, "demo").ok).toBe(false);
    expect(parseDesignSystemPackage({ ...baseFiles, "fonts.html": baseFiles["fonts.html"] + "<script>x</script>" }, "demo").ok).toBe(false);
  });
  it("preview and components are optional but validated", () => {
    const r = parseDesignSystemPackage({ ...baseFiles, "preview.html": "<p>hi</p>" }, "demo");
    expect(r.ok && r.pkg.preview).toBe("<p>hi</p>");
    expect(parseDesignSystemPackage({ ...baseFiles, "components/A.tsx": "x" }, "demo").ok).toBe(false);
  });
});

describe("synthetic package via registry", () => {
  it("exposes metadata, DESIGN.md, tokens, fonts and components", () => {
    expect(pkg).toBeTruthy();
    expect(pkg.meta.name).toBe("Kimble Test System");
    expect(pkg.designMd).toMatch(/design playbook/);
    expect(pkg.tokens.root["kimble-radius-md"]).toBe("0.55rem");
    expect(pkg.tokens.dark.background).toBeTruthy();
    expect(pkg.fonts.some((f) => f.rel === "stylesheet")).toBe(true);
    expect(Object.keys(pkg.components)).toContain("Surface.tsx");
    expect(pkg.preview).toBeNull();
    expect(isValidAccent(pkg, "ember")).toBe(true);
    expect(isValidAccent(pkg, "indigo")).toBe(false);
  });
  it("internal packages are hidden from customer listings", () => {
    expect(listDesignSystems().some((p) => p.meta.slug === SLUG)).toBe(false);
    expect(listDesignSystems({ includeInternal: true }).some((p) => p.meta.slug === SLUG)).toBe(true);
  });
  it("discovers new packages with no code change", () => {
    const m = loadAllDesignSystems(Object.fromEntries(Object.entries(baseFiles).map(([k, v]) => [`./packages/demo/${k}`, v])));
    expect(m.get("demo")?.ok).toBe(true);
  });
});

describe("deterministic application", () => {
  it("installs tokens, accent, fonts and components; identical on re-apply", () => {
    const a = applyDesignSystem(project(), pkg, "lagoon");
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const css = a.files.find((f) => f.path === "src/styles.css")!.content;
    expect(css).toContain(TOKENS_START);
    expect(css).toContain("--primary: oklch(0.56 0.11 200)");
    expect(css.indexOf(TOKENS_START)).toBeGreaterThan(css.indexOf("--background: white"));
    expect(a.files.find((f) => f.path === "src/routes/__root.tsx")!.content).toContain(FONTS_START);
    expect(a.files.some((f) => f.path === `src/components/design-system/${SLUG}/Surface.tsx`)).toBe(true);
    const b = applyDesignSystem(a.files, pkg, "lagoon");
    expect(b.ok && b.changed).toBe(false);
  });
  it("accent change only rewrites the token block", () => {
    const a = applyDesignSystem(project(), pkg, "lagoon");
    if (!a.ok) throw new Error();
    const b = applyDesignSystem(a.files, pkg, "ember");
    expect(b.ok && b.changedPaths).toEqual(["src/styles.css"]);
    if (!b.ok) return;
    const css = b.files.find((f) => f.path === "src/styles.css")!.content;
    expect(css).toContain("oklch(0.6 0.15 45)");
    expect(css).not.toContain("oklch(0.56 0.11 200)");
    expect(css.split(TOKENS_START).length).toBe(2);
  });
  it("fails whole when something cannot be applied", () => {
    const files = project().map((f) => (f.path === "src/routes/__root.tsx" ? { ...f, content: "export {}" } : f));
    expect(applyDesignSystem(files, pkg, "lagoon").ok).toBe(false);
    expect(applyDesignSystem(project(), pkg, "indigo").ok).toBe(false);
  });
});

function fakeDeps(over: Partial<RethemeDeps> = {}) {
  const state = { files: project(), revision: 5, design: design() as PicDesignSystem, snapshots: 0, builds: [] as number[] };
  const deps: RethemeDeps = {
    getPackage: (s) => getDesignSystem(s),
    loadFiles: async () => state.files.map((f) => ({ ...f })),
    snapshot: async () => { state.snapshots++; },
    saveFiles: async (_id, files) => {
      const changed = JSON.stringify(files) !== JSON.stringify(state.files);
      state.files = files as typeof state.files;
      if (changed) state.revision++;
      return state.revision;
    },
    loadDesign: async () => state.design,
    saveDesign: async (_id, d) => { state.design = d; },
    triggerBuild: async (_id, rev) => { state.builds.push(rev); },
    ...over,
  };
  return { state, deps };
}

describe("re-theme pipeline", () => {
  it("snapshots, saves, records selection and builds the new revision", async () => {
    const { state, deps } = fakeDeps();
    const r = await rethemeProject(deps, { projectId: "p", systemId: SLUG });
    expect(r).toMatchObject({ ok: true, changed: true, revision: 6, built: true });
    expect(state.snapshots).toBe(1);
    expect(state.design.package).toEqual({ systemId: SLUG, accent: "lagoon" });
    expect(state.builds).toEqual([6]);
    // Old build (rev 5) is stale against the new revision.
    expect(buildRevisionStatus({ project_revision: 5 }, { revision: state.revision }).current).toBe(false);
    expect(buildRevisionStatus({ project_revision: 6 }, { revision: state.revision }).current).toBe(true);
  });
  it("does not bump the revision or build when nothing changes", async () => {
    const { state, deps } = fakeDeps();
    await rethemeProject(deps, { projectId: "p", systemId: SLUG });
    const r = await rethemeProject(deps, { projectId: "p", systemId: SLUG });
    expect(r).toMatchObject({ ok: true, changed: false, revision: null });
    expect(state.revision).toBe(6);
    expect(state.builds).toEqual([6]);
  });
  it("rejects unknown systems and foreign accents before touching anything", async () => {
    const { state, deps } = fakeDeps();
    expect((await rethemeProject(deps, { projectId: "p", systemId: "nope" })).ok).toBe(false);
    expect((await rethemeProject(deps, { projectId: "p", systemId: SLUG, accent: "indigo" })).ok).toBe(false);
    expect(state.snapshots).toBe(0);
    expect(state.revision).toBe(5);
  });
  it("a failed save leaves files, revision and selection untouched", async () => {
    const { state, deps } = fakeDeps({ saveFiles: async () => { throw new Error("tx aborted"); } });
    const before = JSON.stringify(state.files);
    const r = await rethemeProject(deps, { projectId: "p", systemId: SLUG });
    expect(r).toMatchObject({ ok: false, stage: "save" });
    expect(JSON.stringify(state.files)).toBe(before);
    expect(state.revision).toBe(5);
    expect(state.design.package).toBeUndefined();
    expect(state.builds).toEqual([]);
  });
});

describe("association and AI context", () => {
  it("generations keep the selected system and cannot introduce or swap one", () => {
    const prev = design({ package: { systemId: SLUG, accent: "ember" } });
    expect(preserveDesignPackage(prev, design({ direction: "new" }))?.package).toEqual(prev.package);
    expect(preserveDesignPackage(prev, design({ package: { systemId: "other", accent: "x" } }))?.package).toEqual(prev.package);
    expect(preserveDesignPackage(design(), design({ package: { systemId: "other", accent: "x" } }))?.package).toBeUndefined();
    expect(preserveDesignPackage(prev, null)?.package).toEqual(prev.package);
  });
  it("AI context carries metadata, playbook, accent, fonts and token names but not raw CSS", () => {
    const text = renderDesignSystemContext(pkg, "ember");
    expect(text).toContain("Kimble Test System");
    expect(text).toContain("design playbook");
    expect(text).toContain("Accent: ember");
    expect(text).toContain("Sora");
    expect(text).toContain("--kimble-radius-md");
    expect(text).toMatch(/user's explicit request > project requirements > this design system > generic/);
    expect(text).not.toContain("0.55rem");
    expect(designSystemBlockFor(design({ package: { systemId: SLUG, accent: "ember" } }))).toBe(text);
    expect(designSystemBlockFor(design())).toBe("");
    expect(designSystemBlockFor(design({ package: { systemId: SLUG, accent: "indigo" } }))).toBe("");
  });
});
