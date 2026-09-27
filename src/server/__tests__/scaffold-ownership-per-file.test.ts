/**
 * Regression for bakery benchmark f187e90d: a model-authored
 * `src/components/blocks/bakery-contact-band.tsx` was treated as scaffold
 * because its DIRECTORY was a blanket owned prefix, so the readiness verifier
 * dropped it and reported Home/Contact imports as missing. Ownership is per
 * file (kit manifest), not per directory.
 */
import { describe, expect, it } from "vitest";
import { KIT_FILES, applyScaffoldKit } from "@/server/scaffold-kit";
import {
  isScaffoldOwnedPath,
  isVerifierExempt,
  projectAuthoredFiles,
  scaffoldKitManifest,
  SCAFFOLD_OWNED_PREFIXES,
} from "@/server/scaffold-ownership.server";
import { ensureRenderableShell } from "@/server/renderable-shell.server";
import { verifyProposedSource } from "@/server/verification/source.server";
import { readinessOf } from "@/server/verification/readiness";
import { dependencyGate } from "@/server/verification/gates";
import { runToolLoop, type ModelReply, type ToolCallMsg } from "@/server/engine/tool-loop";
import { validateUnitImports } from "@/server/engine/work-unit";
import type { ProjectFile } from "@/server/generate.server";

const HERO = "src/components/blocks/hero-centered.tsx";
const BAND = "src/components/blocks/bakery-contact-band.tsx";

const f = (path: string, content: string): ProjectFile => ({ path, content });
let n = 0;
const call = (name: string, args: Record<string, unknown>): ToolCallMsg => ({ id: `s${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (...calls: ToolCallMsg[]): ModelReply => ({ content: null, toolCalls: calls });

const band = f(BAND, `export function BakeryContactBand(){return <section>Visit us</section>}\n`);
const page = (name: string, useBand: boolean) =>
  f(`src/pages/${name}.tsx`, `${useBand ? `import { BakeryContactBand } from "@/components/blocks/bakery-contact-band";\n` : ""}export default function ${name}(){return <main><h1>${name}</h1>${useBand ? "<BakeryContactBand/>" : ""}</main>}\n`);
const app = f(
  "src/App.tsx",
  `import { BrowserRouter, Routes, Route } from "react-router-dom";\nimport Home from "@/pages/Home";\nimport Contact from "@/pages/Contact";\nexport default function App(){return <BrowserRouter><header>Crumb</header><Routes><Route path="/" element={<Home/>}/><Route path="/contact" element={<Contact/>}/></Routes><footer>Crumb</footer></BrowserRouter>}\n`,
);

/** The exact readiness transform generate.ts hands the loop. */
async function readiness(tree: ProjectFile[], changed: string[]) {
  const proposed = ensureRenderableShell(applyScaffoldKit(projectAuthoredFiles(tree))).files;
  const v = await verifyProposedSource({
    tree: proposed,
    changedPaths: changed.filter((p) => proposed.some((x) => x.path === p)),
    requestedRoutes: [],
    requireShell: true,
  });
  return readinessOf(v);
}

describe("scaffold ownership is per file, not per directory", () => {
  it("starter-kit file stays owned; a sibling authored file is project code", () => {
    expect(KIT_FILES.some((k) => k.path === HERO)).toBe(true);
    expect(isScaffoldOwnedPath(HERO)).toBe(true);
    expect(isScaffoldOwnedPath(BAND)).toBe(false);
    expect(isVerifierExempt(BAND)).toBe(false);
  });

  it("directory alone never decides ownership for any shared kit directory", () => {
    const dirs = new Set([...scaffoldKitManifest()].filter((p) => p.startsWith("src/components/")).map((p) => p.slice(0, p.lastIndexOf("/") + 1)));
    expect(dirs.size).toBeGreaterThan(3);
    for (const d of dirs) {
      expect(isScaffoldOwnedPath(`${d}zz-project-authored-widget.tsx`), d).toBe(false);
    }
    // Only fully generated directories remain prefix-owned.
    expect([...SCAFFOLD_OWNED_PREFIXES]).toEqual(["src/integrations/backend/"]);
    expect(isScaffoldOwnedPath("src/integrations/backend/client.ts")).toBe(true);
  });

  it("every overwritten kit file is still owned (protection not weakened)", () => {
    for (const k of KIT_FILES.filter((x) => x.overwrite)) expect(isScaffoldOwnedPath(k.path), k.path).toBe(true);
  });

  it("authored file survives the readiness tree and dependencies resolve", async () => {
    const tree = [band, page("Home", true), page("Contact", true), app];
    const authored = projectAuthoredFiles(tree);
    expect(authored.map((x) => x.path)).toContain(BAND);
    const proposed = applyScaffoldKit(authored);
    const deps = dependencyGate(proposed);
    expect(JSON.stringify(deps)).not.toContain("bakery-contact-band");
    const r = await readiness(tree, tree.map((x) => x.path));
    expect(r.findings.filter((x) => JSON.stringify(x).includes("bakery-contact-band"))).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("the real loop finishes (no false missing-import) and returns the authored file", async () => {
    const reference = applyScaffoldKit([]).filter((x) => x.path !== "src/App.tsx" && !x.path.startsWith("src/pages/"));
    const steps = [
      reply(call("create_file", band)),
      reply(call("create_file", page("Home", true)), call("create_file", page("Contact", true))),
      reply(call("create_file", app)),
      reply(call("finish", {})),
    ];
    const written: string[] = [];
    const r = await runToolLoop({
      goal: "bakery", system: "s", brief: "b", files: [], reference,
      validate: (file, t) => validateUnitImports(file, t).map((d) => d.message),
      readiness,
      onWrite: (file) => { written.push(file.path); return true; },
      callModel: async () => steps.shift() ?? reply(call("finish", {})),
    });
    expect(r.outcome).toBe("finished");
    expect(r.files.map((x) => x.path).sort()).toEqual([BAND, "src/App.tsx", "src/pages/Contact.tsx", "src/pages/Home.tsx"].sort());
    // Checkpoint/staging sink saw every authored file, including the block.
    expect(written).toContain(BAND);
    // Commit transform keeps it too.
    const committed = applyScaffoldKit(projectAuthoredFiles(r.files));
    expect(committed.find((x) => x.path === BAND)?.content).toBe(band.content);
    expect(committed.find((x) => x.path === HERO)?.content).toBe(KIT_FILES.find((k) => k.path === HERO)!.content);
  });

  it("negative: overwriting a real starter-kit file is still refused", async () => {
    const reference = applyScaffoldKit([]).filter((x) => x.path !== "src/App.tsx" && !x.path.startsWith("src/pages/"));
    const steps = [reply(call("create_file", { path: HERO, content: "export const X = 1;\n" })), reply(call("finish", {}))];
    const r = await runToolLoop({
      goal: "g", system: "s", brief: "b", files: [], reference,
      validate: () => [],
      readiness: () => ({ ready: true, findings: [] }),
      callModel: async () => steps.shift() ?? reply(call("finish", {})),
    });
    expect(r.files.some((x) => x.path === HERO)).toBe(false);
    // And the commit transform drops/overwrites any attempt that slipped in.
    const committed = applyScaffoldKit(projectAuthoredFiles([f(HERO, "hijack")]));
    expect(committed.find((x) => x.path === HERO)?.content).not.toBe("hijack");
  });
});
