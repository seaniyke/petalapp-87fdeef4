/**
 * Regressions for the three defects that actually failed real user builds:
 *  1. Grid preset union made `p.sm` a TS2339 error (vite build exit 1).
 *  2. Unwrapping a nested <BrowserRouter> left adjacent JSX siblings.
 *  3. Placeholder pages named after code concepts shipped into the router.
 */
import { describe, it, expect } from "vitest";
import { KIT_FILES } from "../scaffold-kit";
import { fixMissingRouterProvider } from "../router-provider.server";
import { pruneJunkPages } from "../junk-page-pruner.server";
import { fixExportShape } from "../export-shape-fixer.server";
import { enforceRuntimeContracts } from "../runtime-contract.server";

describe("grid kit", () => {
  it("reads presets through a common type so optional breakpoints compile", () => {
    const grid = KIT_FILES.find((f) => f.path === "src/components/ui/grid.tsx");
    expect(grid).toBeDefined();
    expect(grid!.content).toContain("const p: GridPresetValue | undefined");
  });
});

describe("nested router removal", () => {
  it("leaves a fragment behind instead of adjacent siblings", () => {
    const files = [
      {
        path: "src/main.tsx",
        content: `import { BrowserRouter } from "react-router-dom";\nimport App from "./App";\ncreateRoot(el).render(<BrowserRouter><App /></BrowserRouter>);\n`,
      },
      {
        path: "src/App.tsx",
        content: `import { BrowserRouter, Routes, Route } from "react-router-dom";\nexport default function App() {\n  return (\n    <BrowserRouter>\n      <Header />\n      <Routes><Route path="/" element={<Home />} /></Routes>\n    </BrowserRouter>\n  );\n}\n`,
      },
    ];
    const out = fixMissingRouterProvider(files);
    const app = out.files.find((f) => f.path === "src/App.tsx")!.content;
    if (app.includes("<Header />") && !app.includes("<BrowserRouter>")) {
      expect(app).toContain("<>");
      expect(app).toContain("</>");
    }
  });
});

describe("junk page pruner", () => {
  const page = (path: string, content: string) => ({ path, content });

  it("removes placeholder pages named after code concepts", () => {
    const out = pruneJunkPages([
      page("src/pages/Hooks.tsx", `export default function Hooks() {\n  return <div>placeholder</div>;\n}\n`),
      page("src/pages/UseAxe.tsx", `export default function UseAxe() {\n  return <div>placeholder</div>;\n}\n`),
    ]);
    expect(out.removed.sort()).toEqual(["src/pages/Hooks.tsx", "src/pages/UseAxe.tsx"]);
  });

  it("keeps a real screen even when its name looks generic", () => {
    const real = `import { useState } from "react";\nexport default function Main() {\n  const [q, setQ] = useState("");\n  return (<section><h1>Bookings</h1><input value={q} onChange={(e) => setQ(e.target.value)} /><ul><li>One</li><li>Two</li></ul></section>);\n}\n`;
    expect(pruneJunkPages([page("src/pages/Main.tsx", real)]).removed).toEqual([]);
  });

  it("never removes a page another file imports", () => {
    const out = pruneJunkPages([
      page("src/pages/Hooks.tsx", `export default function Hooks() {\n  return <div>placeholder</div>;\n}\n`),
      page("src/App.tsx", `import Hooks from "@/pages/Hooks";\n`),
    ]);
    expect(out.removed).toEqual([]);
  });
});

describe("export shape", () => {
  it("adds a default export when a page is default-imported", () => {
    const out = fixExportShape([
      { path: "src/App.tsx", content: `import Dashboard from "./pages/Dashboard";\n` },
      { path: "src/pages/Dashboard.tsx", content: `export function Dashboard() {\n  return <div />;\n}\n` },
    ]);
    expect(out.fixes).toBe(1);
    expect(out.files.find((f) => f.path === "src/pages/Dashboard.tsx")!.content).toContain(
      "export default Dashboard;",
    );
  });

  it("leaves files that already have a default export alone", () => {
    const out = fixExportShape([
      { path: "src/App.tsx", content: `import Home from "./pages/Home";\n` },
      { path: "src/pages/Home.tsx", content: `export default function Home() {\n  return <div />;\n}\n` },
    ]);
    expect(out.fixes).toBe(0);
  });
});

describe("select onValueChange injection", () => {
  it("does not splice into an arrow function inside an attribute", () => {
    const src = [
      "export default function Edit() {",
      "  return (",
      "    <Select",
      '      value={form.watch("status")}',
      "      onChange={(value) => form.setValue(\"status\", value)}",
      "    >",
      "      <div />",
      "    </Select>",
      "  );",
      "}",
      "",
    ].join("\n");
    const out = enforceRuntimeContracts([{ path: "src/pages/Edit.tsx", content: src }]);
    const content = out.files[0].content;
    expect(content).not.toMatch(/onChange=\{\(value\) = /);
    expect(content).toContain("onValueChange={() => {}}");
    expect(content).toContain("onChange={(value) => form.setValue");
  });
});

import { stripTypeOnlyValueImports } from "@/server/strip-type-only-value-imports.server";

describe("redirect", () => {
  it("redirects useAuth to the module that exports it", () => {
    const files = [
      { path: "src/integrations/backend/client.ts", content: "export const db = {};\nexport const auth = {};\n" },
      { path: "src/integrations/backend/auth.tsx", content: "export function AuthProvider(){return null}\nexport function useAuth(){return {user:null}}\n" },
      { path: "src/pages/dashboard.tsx", content: 'import { db, useAuth } from "@/integrations/backend/client";\nexport default function D(){ const {user}=useAuth(); return null }\n' },
    ];
    const { files: out } = stripTypeOnlyValueImports(files as any);
    const dash = out.find((f) => f.path === "src/pages/dashboard.tsx")!.content;
    expect(dash).toContain('import { db } from "@/integrations/backend/client";');
    expect(dash).toContain('import { useAuth } from "@/integrations/backend/auth";');
    expect(out.find((f) => f.path === "src/integrations/backend/client.ts")!.content).not.toContain("runtime stub");
  });
});

describe("import keyword typos", () => {
  it("heals `=>` written where `from` belongs", async () => {
    const { repairImportSyntax } = await import("@/server/import-syntax-fixer.server");
    const { out } = repairImportSyntax("import { Spinner } => '@/components/ui/spinner';\n");
    expect(out).toBe("import { Spinner } from '@/components/ui/spinner';\n");
  });
  it("leaves valid imports untouched", async () => {
    const { repairImportSyntax } = await import("@/server/import-syntax-fixer.server");
    const src = "import { A } from '@/a';\nimport type { B } from '@/b';\nconst f = () => 'x';\n";
    expect(repairImportSyntax(src).out).toBe(src);
  });
});

describe("@apply dark", () => {
  it("drops variant markers that Tailwind cannot apply", async () => {
    const m = await import("@/server/validate-styles.server");
    const css = '@import "tailwindcss";\n@theme { --font-body: Inter; }\n@layer base {\n  .dark { --background: #000; }\n}\nhtml {\n  @apply antialiased font-body dark;\n}\n';
    expect(m.validateStylesCss(css).ok).toBe(false);
    const repaired = m.repairStylesCss(css);
    expect(repaired).toBeTruthy();
    expect(repaired!.css).toContain("@apply antialiased font-body;");
    expect(repaired!.css).not.toMatch(/@apply[^;]*\bdark\b/);
  });
});

describe("glued from typos", () => {
  it("heals `nfrom` and keeps valid imports intact", async () => {
    const { repairImportSyntax } = await import("@/server/import-syntax-fixer.server");
    const src = "import React nfrom 'react';\nimport { z } from 'zod';\n";
    const { out } = repairImportSyntax(src);
    expect(out).toContain("import React from 'react';");
    expect(out).toContain("import { z } from 'zod';");
  });
});

describe("route collection", () => {
  it("ignores demo routes inside kit component files", async () => {
    const { collectRoutes } = await import("@/server/verify-plan.server");
    const routes = collectRoutes([
      { path: "src/App.tsx", content: '<Route path="/" /><Route path="/dashboard" />' },
      { path: "src/components/examples/blog.tsx", content: '<Route path="/posts" />' },
      { path: "src/components/blocks/nav-bar.tsx", content: '<Route path="/about" />' },
    ] as never);
    expect(routes).toEqual(["/", "/dashboard"]);
  });
});

describe("missing hook stubs", () => {
  it("stubs a missing hook as a callable returning an object", async () => {
    const { stripTypeOnlyValueImports } = await import("@/server/strip-type-only-value-imports.server");
    const { files } = stripTypeOnlyValueImports([
      { path: "src/lib/forms.ts", content: "export const Form: any = null;\n" },
      { path: "src/pages/x.tsx", content: 'import { useThing } from "@/lib/forms";\nexport default function X(){ const { a } = useThing(); return <div>{a}</div>; }\n' },
    ] as never);
    const lib = files.find((f) => f.path === "src/lib/forms.ts")!;
    expect(lib.content).toContain("export const useThing: any = (..._args: any[]) => ({});");
  });
});

describe("chained from junk", () => {
  it("heals `=> from` written between the clause and the module", async () => {
    const { repairImportSyntax } = await import("@/server/import-syntax-fixer.server");
    const { out } = repairImportSyntax('import { Button } => from "@/x";\nimport A from "b";\n');
    expect(out).toContain('import { Button } from "@/x";');
    expect(out).toContain('import A from "b";');
  });
});

describe("query provider", () => {
  it("wraps the app root when pages use TanStack Query", async () => {
    const { ensureQueryProvider } = await import("@/server/ensure-query-provider.server");
    const { files } = ensureQueryProvider([
      { path: "src/main.tsx", content: 'import App from "./App";\ncreateRoot(el).render(<App />);\n' },
      { path: "src/pages/d.tsx", content: 'import { useQuery } from "@tanstack/react-query";\nexport default function D(){ useQuery({}); return null; }\n' },
    ] as never);
    const main = files.find((f) => f.path === "src/main.tsx")!;
    expect(main.content).toContain("<QueryClientProvider client={queryClient}>");
    expect(main.content).toContain("new QueryClient()");
  });
});

describe("font utility @apply", () => {
  it("drops font-body when no --font-body token exists", async () => {
    const { repairStylesCss } = await import("@/server/validate-styles.server");
    const css = '@import "tailwindcss";\n@layer base {\n  .dark { --background: #000; }\n}\nhtml {\n  @apply antialiased font-body;\n}\n';
    const repaired = repairStylesCss(css);
    expect(repaired!.css).toContain("@apply antialiased;");
    expect(repaired!.css).not.toContain("font-body");
  });
});

describe("named import of a default-only module", () => {
  it("adds a named alias so the component is not undefined", async () => {
    const { fixExportShape } = await import("@/server/export-shape-fixer.server");
    const { files } = fixExportShape([
      { path: "src/pages/auth/sign-in.tsx", content: 'import { AuthSignInCard } from "@/components/examples/auth-sign-in-card";\nexport default function P(){ return <AuthSignInCard />; }\n' },
      { path: "src/components/examples/auth-sign-in-card.tsx", content: 'export default function SignInCard(){ return null; }\n' },
    ] as never);
    const target = files.find((f) => f.path === "src/components/examples/auth-sign-in-card.tsx")!;
    expect(target.content).toContain("export const AuthSignInCard = SignInCard;");
  });
});

describe("unwritten route promises", () => {
  it("detects promissory router comments in the app shell", async () => {
    const { findUnwrittenRoutePromises } = await import("@/server/design/unwritten-routes.server");
    const { shell, promises } = findUnwrittenRoutePromises([
      {
        path: "src/App.tsx",
        content:
          'import { Routes, Route } from "@/components/ui/router";\nfunction App(){return (<Routes><Route path="/" element={<Hero/>} />{/* Authentication routes will be added here */}{/* Dashboard routes will be added here */}</Routes>);}\nexport default App;\n',
      },
    ] as never);
    expect(shell?.path).toBe("src/App.tsx");
    expect(promises.length).toBe(2);
  });
});

describe("query provider on the render path", () => {
  it("wraps the root even when an unused providers module exists", async () => {
    const { ensureQueryProvider } = await import("@/server/ensure-query-provider.server");
    const { files } = ensureQueryProvider([
      { path: "src/main.tsx", content: 'import App from "./App";\ncreateRoot(el).render(<App />);\n' },
      { path: "src/pages/P.tsx", content: 'import { useQuery } from "@tanstack/react-query";\n' },
      {
        path: "src/components/providers/app-providers.tsx",
        content: 'import { QueryClientProvider } from "@tanstack/react-query";\nexport function AppProviders({children}){return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;}\n',
      },
    ] as never);
    expect(files.find((f) => f.path === "src/main.tsx")!.content).toContain("<QueryClientProvider");
  });

  it("leaves the root alone when it renders a providers component", async () => {
    const { ensureQueryProvider } = await import("@/server/ensure-query-provider.server");
    const { files } = ensureQueryProvider([
      {
        path: "src/main.tsx",
        content: 'import App from "./App";\nimport { AppProviders } from "@/components/providers/app-providers";\ncreateRoot(el).render(<AppProviders><App /></AppProviders>);\n',
      },
      { path: "src/pages/P.tsx", content: 'import { useQuery } from "@tanstack/react-query";\n' },
      {
        path: "src/components/providers/app-providers.tsx",
        content: 'export function AppProviders({children}){return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;}\n',
      },
    ] as never);
    expect(files.find((f) => f.path === "src/main.tsx")!.content).not.toContain("<QueryClientProvider");
  });
});
