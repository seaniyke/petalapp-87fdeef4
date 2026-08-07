import { describe, it, expect } from "vitest";
import { repairScopeLeaks } from "../scope-repair.server";

const pkg = {
  path: "package.json",
  content: JSON.stringify({ dependencies: { react: "19", "framer-motion": "11", sonner: "1" } }),
};

describe("scope repair (A4)", () => {
  it("imports forgotten react hooks", () => {
    const out = repairScopeLeaks([
      pkg,
      {
        path: "src/components/Counter.tsx",
        content: `export function Counter() {\n  const [n, setN] = useState(0);\n  useEffect(() => {}, []);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}\n`,
      },
    ]);
    const src = out.files[1].content;
    expect(src).toMatch(/import \{ useEffect, useState \} from "react";/);
    expect(out.fixes).toBe(2);
  });

  it("merges into an existing react import instead of duplicating", () => {
    const out = repairScopeLeaks([
      pkg,
      {
        path: "src/A.tsx",
        content: `import { useState } from "react";\nexport const A = () => {\n  const r = useRef(null);\n  const [v] = useState(1);\n  return <div ref={r}>{v}</div>;\n};\n`,
      },
    ]);
    const src = out.files[1].content;
    expect(src.match(/from "react"/g)?.length).toBe(1);
    expect(src).toMatch(/useState, useRef|useRef, useState/);
  });

  it("imports lucide icons used as JSX tags", () => {
    const out = repairScopeLeaks([
      pkg,
      {
        path: "src/Hero.tsx",
        content: `export const Hero = () => <div><Sparkles className="h-4 w-4" /></div>;\n`,
      },
    ]);
    expect(out.files[1].content).toMatch(/import \{ Sparkles \} from "lucide-react";/);
  });

  it("uses the router the project already uses", () => {
    const out = repairScopeLeaks([
      pkg,
      { path: "src/App.tsx", content: `import { Routes } from "react-router-dom";\nexport const App = () => <Routes />;\n` },
      { path: "src/Nav.tsx", content: `export const Nav = () => <Link to="/">Home</Link>;\n` },
    ]);
    expect(out.files[2].content).toMatch(/import \{ Link \} from "react-router-dom";/);
  });

  it("does not inject a router symbol when no router is present", () => {
    const out = repairScopeLeaks([
      pkg,
      { path: "src/Nav.tsx", content: `export const Nav = () => <Link to="/">Home</Link>;\n` },
    ]);
    expect(out.files[1].content).not.toMatch(/react-router-dom/);
  });

  it("leaves already-declared identifiers alone", () => {
    const before = `const cn = (a: string) => a;\nexport const A = () => <div className={cn("x")} />;\n`;
    const out = repairScopeLeaks([pkg, { path: "src/A.tsx", content: before }]);
    expect(out.files[1].content).toBe(before);
    expect(out.fixes).toBe(0);
  });

  it("ignores identifiers inside strings and comments", () => {
    const before = `// useState is nice\nexport const A = () => <p>{"Sparkles"}</p>;\n`;
    const out = repairScopeLeaks([pkg, { path: "src/A.tsx", content: before }]);
    expect(out.files[1].content).toBe(before);
  });

  it("skips destructured locals like toast", () => {
    const before = `const { toast } = makeToast();\nexport const A = () => { toast("hi"); return null; };\n`;
    const out = repairScopeLeaks([pkg, { path: "src/A.tsx", content: before }]);
    expect(out.files[1].content).not.toMatch(/from "sonner"/);
  });
});
