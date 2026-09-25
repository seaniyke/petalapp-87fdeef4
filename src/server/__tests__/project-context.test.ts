import { describe, it, expect } from "vitest";
import {
  buildProjectManifest,
  selectContext,
  detectContextFlags,
  classifyMemory,
  resolveMemory,
  renderResolvedMemory,
  shouldRecordMemory,
  applyContextBudget,
  outranks,
  extractDesignIntel,
  assembleProjectContext,
} from "@/server/context";

const files = [
  { path: "package.json", content: JSON.stringify({ dependencies: { react: "19", "react-router-dom": "6" } }) },
  {
    path: "src/App.tsx",
    content: `import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Pricing from "./pages/Pricing";
import Login from "./pages/Login";
import SiteHeader from "./components/SiteHeader";
export default function App(){return <><SiteHeader/><Routes><Route path="/" element={<Home/>}/><Route path="/pricing" element={<Pricing/>}/><Route path="/login" element={<Login/>}/></Routes></>}`,
  },
  { path: "src/pages/Home.tsx", content: `import HeroSection from "../components/HeroSection";\nimport Button from "../components/Button";\nexport default function Home(){return <HeroSection/>}` },
  { path: "src/pages/Pricing.tsx", content: `import PricingSection from "../components/PricingSection";\nimport Button from "../components/Button";\nexport default function P(){return <PricingSection/>}` },
  { path: "src/pages/Login.tsx", content: `export default function L(){return <form className="max-w-md rounded-xl"><input aria-label="Email"/></form>}` },
  { path: "src/components/HeroSection.tsx", content: `export default function H(){return <section className="min-h-screen py-24"><button className="rounded-full px-6 py-3 bg-primary">Go</button></section>}` },
  { path: "src/components/PricingSection.tsx", content: `export default function P(){return <div className="shadow-lg rounded-xl"/>}` },
  { path: "src/components/Button.tsx", content: `export default function B(){return <button/>}` },
  { path: "src/components/SiteHeader.tsx", content: `export default function S(){return <nav className="flex gap-4"><a href="/pricing">Pricing</a></nav>}` },
  { path: "src/styles.css", content: `:root{--background: oklch(0.99 0 0);--primary: oklch(0.5 0.2 30);--radius: 0.75rem;--font-display: "Sora", sans-serif;}` },
  { path: "public/hero.jpg", content: "" },
];

const manifest = buildProjectManifest(files, { projectId: "p1" });

describe("manifest", () => {
  it("indexes project reality without copying source", () => {
    expect(manifest.framework.router).toBe("react-router-dom");
    expect(manifest.pages.find((p) => p.path === "src/pages/Home.tsx")?.type).toBe("home");
    expect(manifest.pages.find((p) => p.path === "src/pages/Login.tsx")?.type).toBe("auth");
    expect(manifest.sharedComponents).toContain("src/components/Button.tsx");
    expect(manifest.images).toEqual(["public/hero.jpg"]);
    expect(manifest.dependencies).toContain("react-router-dom");
    expect(JSON.stringify(manifest)).not.toContain("export default function");
  });
  it("reads the existing design language", () => {
    const d = extractDesignIntel(files);
    expect(d.colors.primary).toContain("oklch");
    expect(d.radius).toBe("0.75rem");
    expect(d.fonts.display).toBe("Sora");
  });
});

describe("focused context selection", () => {
  it("hero button on homepage loads home + hero, not everything", () => {
    const s = selectContext("Change the hero button on the homepage", manifest);
    expect(s.primary).toContain("src/pages/Home.tsx");
    expect(s.primary).toContain("src/components/HeroSection.tsx");
    expect(s.primary).not.toContain("src/pages/Pricing.tsx");
    expect(s.primary).not.toContain("src/pages/Login.tsx");
    expect([...s.primary, ...s.supporting]).toContain("src/components/Button.tsx");
  });
  it("explicit targets win", () => {
    const s = selectContext("make it nicer", manifest, { explicitTargets: ["src/pages/Login.tsx"] });
    expect(s.primary).toEqual(["src/pages/Login.tsx"]);
  });
  it("nav asks pull the shared layout", () => {
    expect(selectContext("add a link to the navbar", manifest).supporting).toContain("src/components/SiteHeader.tsx");
  });
});

describe("conditional context fails closed", () => {
  it("no backend info without a backend", () => {
    const f = detectContextFlags("save users to the database", manifest, { isInitial: false });
    expect(f.backend).toBe(false);
    expect(f.database).toBe(false);
  });
  it("backend only when connected and relevant", () => {
    const withDb = buildProjectManifest(files, { backendKind: "dedicated" });
    expect(detectContextFlags("save users to the database", withDb, { isInitial: false }).database).toBe(true);
    expect(detectContextFlags("change the headline text", withDb, { isInitial: false }).backend).toBe(false);
  });
  it("images and deployment only when asked", () => {
    const f = detectContextFlags("fix the typo in the footer", manifest, { isInitial: false });
    expect(f.images).toBe(false);
    expect(f.deployment).toBe(false);
    expect(f.commerce).toBe(false);
  });
});

describe("memory classification", () => {
  it("classifies kinds and never promotes inference to fact", () => {
    expect(classifyMemory({ key: "dont_do", value: "keep the navbar unchanged" })).toBe("DECISION");
    expect(classifyMemory({ key: "tone", value: "playful" })).toBe("USER_PREFERENCE");
    expect(classifyMemory({ key: "notes", value: "pricing redesigned last turn" })).toBe("HISTORY");
    expect(classifyMemory({ key: "payments", value: "provider not yet configured" })).toBe("UNKNOWN");
    expect(classifyMemory({ key: "name", value: "probably Harbor Lane" })).toBe("INFERENCE");
    expect(classifyMemory({ key: "random_guess", value: "users are students" })).toBe("INFERENCE");
  });
  it("renders kinds explicitly", () => {
    const out = renderResolvedMemory(resolveMemory([{ key: "dont_do", value: "no emoji" }], manifest, ""));
    expect(out).toContain("[DECISION]");
  });
});

describe("source-of-truth precedence", () => {
  it("order is request > source > build > manifest > memory > history > inference", () => {
    expect(outranks("USER_REQUEST", "SOURCE")).toBe(true);
    expect(outranks("SOURCE", "RECENT_MEMORY")).toBe(true);
    expect(outranks("HISTORY", "INFERENCE")).toBe(true);
    expect(outranks("RECENT_MEMORY", "SOURCE")).toBe(false);
  });
  it("stale memory naming a removed component is dropped (source wins)", () => {
    const r = resolveMemory([{ key: "state_home", value: "Homepage contains TestimonialCarousel" }], manifest, "");
    expect(r[0]!.status).toBe("stale");
    expect(renderResolvedMemory(r)).toBe("");
  });
  it("memory matching current source stays active", () => {
    const r = resolveMemory([{ key: "state_home", value: "Homepage contains HeroSection" }], manifest, "");
    expect(r[0]!.status).toBe("active");
  });
  it("the current request overrides old memory", () => {
    const r = resolveMemory([{ key: "must_have", value: "dark theme everywhere" }], manifest, "remove dark theme and use light");
    expect(r[0]!.status).toBe("overridden");
  });
});

describe("context budget", () => {
  it("keeps everything when under budget", () => {
    const r = applyContextBudget([{ id: "a", priority: "required", text: "x".repeat(100) }], 1000);
    expect(r.dropped).toEqual([]);
  });
  it("drops low-value history first and never required", () => {
    const r = applyContextBudget(
      [
        { id: "system", priority: "required", text: "x".repeat(3200) },
        { id: "memory", priority: "memory", text: "m".repeat(640) },
        { id: "learning", priority: "history", text: "h".repeat(640) },
        { id: "design", priority: "design", text: "d".repeat(640) },
      ],
      1300,
    );
    expect(r.dropped[0]).toBe("learning");
    expect(r.dropped).not.toContain("system");
    expect(r.dropped).not.toContain("design");
  });
  it("reports when required alone exceeds the budget instead of truncating", () => {
    const r = applyContextBudget([{ id: "system", priority: "required", text: "x".repeat(6400) }], 100);
    expect(r.overRequired).toBe(true);
    expect(r.kept).toHaveLength(1);
  });
});

describe("post-commit memory", () => {
  it("only committed, complete, uncancelled changes become memory", () => {
    expect(shouldRecordMemory({ committed: true })).toBe(true);
    expect(shouldRecordMemory({ committed: false })).toBe(false);
    expect(shouldRecordMemory({ committed: true, rolledBack: true })).toBe(false);
    expect(shouldRecordMemory({ committed: true, cancelled: true })).toBe(false);
    expect(shouldRecordMemory({ committed: true, missingScope: 1 })).toBe(false);
  });
});

describe("first build vs edit", () => {
  it("first build has no manifest; edit does", () => {
    const first = assembleProjectContext({ files: [], request: "Build a bakery site", isInitial: true, memoryEntries: [] });
    expect(first.manifest).toBeNull();
    expect(first.flags.design).toBe(true);
    const edit = assembleProjectContext({ files, request: "change the pricing card shadow", isInitial: false, memoryEntries: [] });
    expect(edit.selection?.primary).toContain("src/pages/Pricing.tsx");
    expect(edit.structureBlock).toContain("PROJECT STRUCTURE");
  });
});
