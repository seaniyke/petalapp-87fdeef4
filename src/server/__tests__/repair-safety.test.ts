import { describe, it, expect } from "vitest";
import { runAllRepairs } from "@/server/repair-all.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";
import { unescapeCodePositions } from "@/server/source-escape-fixer.server";
import { scanOpeningTag, rewriteOpeningTags } from "@/server/jsx-tag-scan.server";
import { COMMON_LUCIDE_ICONS } from "@/server/known-packages";
import { validateRouteGraph } from "@/server/route-graph.server";

/**
 * Every case here is a real build failure taken from a Petal digest, not a
 * hypothetical. They all share one root cause family: a repair pass mutating
 * source at a boundary it guessed wrong.
 */

describe("jsx tag scanner", () => {
  it("finds the real tag end past a `>` inside an attribute expression", () => {
    const src = `<Input placeholder="Search" onChange={(e) => onSearch?.(e.target.value)} />`;
    const tag = scanOpeningTag(src, 0)!;
    expect(tag.selfClosing).toBe(true);
    expect(tag.end).toBe(src.length);
  });

  it("handles nested JSX inside an expression container", () => {
    const src = `<Route path="/" element={<Home />} />after`;
    const tag = scanOpeningTag(src, 0)!;
    expect(src.slice(tag.end)).toBe("after");
  });

  it("does not mistake a `>` inside a string for the tag end", () => {
    const src = `<div title="a > b">x</div>`;
    const tag = scanOpeningTag(src, 0)!;
    expect(tag.selfClosing).toBe(false);
    expect(src.slice(tag.start, tag.end)).toBe(`<div title="a > b">`);
  });

  it("rewrites only matching tags and stays offset-correct", () => {
    const src = `<img src="a.png" /><span/><img src="b.png" onLoad={() => 1} />`;
    const r = rewriteOpeningTags(src, (n) => n === "img", (t) => `<img${t.attrs} data-x />`);
    expect(r.fixes).toBe(2);
    expect(r.content).toContain("<span/>");
    expect(r.content).toContain("onLoad={() => 1}  data-x />");
  });
});

describe("source escape fixer", () => {
  it("leaves escapes inside a regex literal alone", () => {
    // Real crash: markdown-view.tsx became `.replace(/` + newline + `$/, "")`
    const src = `const text = String(children).replace(/\\n$/, "");`;
    expect(unescapeCodePositions(src).out).toBe(src);
  });

  it("leaves character-class escapes alone", () => {
    const src = `const m = /language-(\\w+)/.exec(className || "");`;
    expect(unescapeCodePositions(src).out).toBe(src);
  });

  it("still treats a lone `/` as division and keeps scanning", () => {
    const src = `const half = total / 2;\nconst a = 1;`;
    expect(unescapeCodePositions(src).out).toBe(src);
  });
});

describe("builder boundary source escape fixer", () => {
  it("preserves regex escapes before materializing a build", async () => {
    const { unescapeCodePositions: healBuilderSource } = await import(
      "../../../builder/src/syntax-heal"
    );
    const src = `const text = String(children).replace(/\\n$/, "");\nconst m = /language-(\\w+)/.exec(name);`;
    expect(healBuilderSource(src).out).toBe(src);
  });
});

describe("leaked markdown fence repair", () => {
  const productionFailure = `export function PostPage() {
  const title = "A post";

\`\`\`typescript
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

  return <article>{title}</article>;
}
`;

  it("removes the exact PostPage fence failure before app-side shipping", () => {
    const result = runAllRepairs([
      { path: "src/pages/PostPage.tsx", content: productionFailure },
    ]);
    const output = result.files.find((file) => file.path === "src/pages/PostPage.tsx")?.content;
    expect(output).toBeDefined();
    expect(output).not.toContain("```typescript");
    expect(output).not.toContain("function greet");
    expect(result.firedPasses).toContain("markdown-fence");
  });

  it("removes the same failure at the builder boundary and is idempotent", async () => {
    const { healSyntax } = await import("../../../builder/src/syntax-heal");
    const once = healSyntax([
      { path: "src/pages/PostPage.tsx", content: productionFailure },
    ]);
    expect(once.notes).toHaveLength(1);
    expect(once.files[0]?.content).not.toContain("```typescript");
    expect(once.files[0]?.content).not.toContain("function greet");
    expect(healSyntax(once.files).notes).toHaveLength(0);
  });

  it("preserves fences used as display text inside strings and comments", async () => {
    const { healSyntax } = await import("../../../builder/src/syntax-heal");
    const valid = `const sample = "\\`\\`\\`typescript";\n// \\`\\`\\`tsx\nexport default sample;`;
    const result = healSyntax([{ path: "src/sample.ts", content: valid }]);
    expect(result.notes).toHaveLength(0);
    expect(result.files[0]?.content).toBe(valid);
  });
});

describe("repair pipeline does not corrupt valid JSX", () => {
  const cases: Array<{ name: string; content: string; mustKeep: string }> = [
    {
      name: "src/components/widget-filter-bar.tsx",
      content: `export function FilterBar({ onSearch }: { onSearch?: (v: string) => void }) {
  return (
    <div>
      <input placeholder="Search…" onChange={(e) => onSearch?.(e.target.value)} />
    </div>
  );
}
`,
      mustKeep: "onChange={(e) => onSearch?.(e.target.value)}",
    },
    {
      name: "src/components/signup-form.tsx",
      content: `export function SignupForm() {
  return (
    <form onChange={(e) => console.log(e)}>
      <button type="submit">Join</button>
    </form>
  );
}
`,
      mustKeep: "onChange={(e) => console.log(e)}",
    },
    {
      name: "src/components/hero-image.tsx",
      content: `export function HeroImage() {
  return <img src="https://cdn.example.com/a.png" onClick={() => alert("hi")} alt="Hero" />;
}
`,
      mustKeep: `onClick={() => alert("hi")}`,
    },
    {
      name: "src/components/markdown-view.tsx",
      content: `export function code({ children, className }: any) {
  const text = String(children).replace(/\\n$/, "");
  const m = /language-(\\w+)/.exec(className || "");
  return <code data-lang={m?.[1]}>{text}</code>;
}
`,
      mustKeep: `replace(/\\n$/, "")`,
    },
  ];

  for (const c of cases) {
    it(`keeps ${c.name} intact`, () => {
      const out = runAllRepairs([{ path: c.name, content: c.content }]).files;
      const file = out.find((f) => f.path === c.name)!;
      expect(file.content).toContain(c.mustKeep);
      // Balanced braces is the cheapest proxy for "still parses".
      const open = (file.content.match(/\{/g) ?? []).length;
      const close = (file.content.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
    });
  }
});

describe("route graph scaffold isolation", () => {
  it("never edits reference examples while deduplicating app routes", () => {
    const app = `export default function App(){return <Routes><Route path="/" element={<main />} /></Routes>}`;
    const example = `export function Example(){return <Routes><Route element={<Layout />}><Route path="/" element={<HomePage />} /></Route></Routes>}`;
    const out = validateRouteGraph([
      { path: "src/App.tsx", content: app },
      { path: "src/components/examples/kit-multi-page-app.tsx", content: example },
    ]).files;
    expect(out.find((file) => file.path.includes("kit-multi-page"))?.content).toBe(example);
  });
});

describe("preview guard", () => {
  const html = `<!doctype html><html><body><div id="root"></div>
    <script type="module" src="/src/main.tsx"></script></body></html>`;

  it("inlines the guard instead of referencing a public file", () => {
    // Rollup fails the production build on `src="/__petal_guard.js?v=N"`.
    const r = injectPreviewGuard([{ path: "index.html", content: html }], { projectId: "p" });
    const out = r.files.find((f) => f.path === "index.html")!.content;
    expect(out).not.toMatch(/src=["'][^"']*__petal_guard/);
    expect(r.files.some((f) => f.path.includes("__petal_guard.js"))).toBe(false);
    expect(out).toContain("__petalPreviewGuardVersion");
  });

  it("runs before the app entry module", () => {
    const out = injectPreviewGuard([{ path: "index.html", content: html }]).files.find(
      (f) => f.path === "index.html",
    )!.content;
    expect(out.indexOf("__petalPreviewGuardVersion")).toBeLessThan(out.indexOf("/src/main.tsx"));
  });

  it("is idempotent and strips stale external tags", () => {
    const stale = html.replace(
      "<script type=",
      `<script src="/__petal_guard.js?v=4"></script><script type=`,
    );
    const once = injectPreviewGuard([{ path: "index.html", content: stale }]);
    const twice = injectPreviewGuard(once.files);
    const a = once.files.find((f) => f.path === "index.html")!.content;
    const b = twice.files.find((f) => f.path === "index.html")!.content;
    expect(b).toBe(a);
    expect((a.match(/data-petal-preview-guard-version/g) ?? []).length).toBe(1);
  });
});

describe("lucide icon allowlist", () => {
  it("covers valid icons that used to be rewritten to Square", () => {
    for (const name of ["CalendarRange", "SlidersHorizontal", "ArrowUpNarrowWide", "Loader2"]) {
      expect(COMMON_LUCIDE_ICONS.has(name)).toBe(true);
    }
  });

  it("still excludes names that do not exist", () => {
    expect(COMMON_LUCIDE_ICONS.has("TotallyMadeUpIcon")).toBe(false);
  });
});
