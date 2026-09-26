import { describe, expect, it } from "vitest";
import { exportSignature, validateUnitImports, stitchContinuation, planWorkUnits, signatureContext } from "@/server/engine/work-unit";
import { withProviderRetry, classifyProviderStatus } from "@/server/engine/provider-retry";
import { runAgentLoop as writePlannedPages } from "@/server/engine/agent-loop";
import { RecoveryBudget } from "@/server/engine/recovery-policy";

const container = { path: "src/components/layout/Container.tsx", content: "export function Container({children}:{children:any}){return <div>{children}</div>}\nexport type Size='sm';" };

describe("work units", () => {
  it("derives real export signatures", () => {
    const s = exportSignature(container.path, container.content);
    expect(s.hasDefault).toBe(false);
    expect(s.named).toEqual(["Container"]);
    expect(s.types).toEqual(["Size"]);
    expect(signatureContext([container])).toContain("NO default export");
  });
  it("flags default-import of a named-only module with the exact fix", () => {
    const page = { path: "src/pages/Doctors.tsx", content: 'import Container from "@/components/layout/Container";\nexport default function D(){return <Container/>}' };
    const d = validateUnitImports(page, [container]);
    expect(d[0]!.message).toContain("NO default export");
    expect(d[0]!.message).toContain("import { Container }");
    expect(validateUnitImports({ ...page, content: page.content.replace("import Container", "import { Container }") }, [container])).toEqual([]);
  });
  it("flags missing modules and missing named exports", () => {
    const page = { path: "src/pages/A.tsx", content: 'import { Nope } from "@/components/layout/Container";\nimport { x } from "@/lib/ghost";' };
    const d = validateUnitImports(page, [container]);
    expect(d.map((x) => x.spec)).toEqual(["@/components/layout/Container", "@/lib/ghost"]);
  });
  it("stitches a continuation without repeating", () => {
    expect(stitchContinuation("a\nb\nhalf-li", "line\nc\n")).toBe("a\nb\nline\nc\n");
  });
  it("layers foundation before pages before router", () => {
    const l = planWorkUnits([{ route: "/", file: "src/pages/Home.tsx" }], ["src/lib/data.ts"]);
    expect(l.map((x) => x[0]!.kind)).toEqual(["foundation", "page", "router"]);
    expect(l[1]![0]!.dependsOn).toEqual(["foundation:src/lib/data.ts"]);
  });
});

describe("writer feedback loop", () => {
  const frame = { path: "src/App.tsx", content: 'import Home from "@/pages/Home";\n<Routes><Route/></Routes> nav footer' };
  it("returns validation feedback to the same writer and accepts the correction", async () => {
    const asked: string[] = [];
    const r = await writePlannedPages({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }],
      files: [frame, container],
      budget: new RecoveryBudget(),
      request: async (i) => {
        asked.push(i);
        const fixed = i.includes("IMMEDIATE VALIDATION FEEDBACK");
        return [{ path: "src/pages/Home.tsx", content: `import ${fixed ? "{ Container }" : "Container"} from "@/components/layout/Container";\nexport default function Home(){return <Container>hi</Container>}` }];
      },
    });
    expect(asked.length).toBe(2);
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toContain("{ Container }");
    expect(r.units.find((u) => u.kind === "page")!.outcome).toBe("corrected");
  });
  it("continues a cut-off page instead of regenerating it", async () => {
    const asked: string[] = [];
    const r = await writePlannedPages({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }],
      files: [frame],
      budget: new RecoveryBudget(),
      isTruncated: async (f) => !f.content.includes("END"),
      request: async (i) => {
        asked.push(i);
        return [{ path: "src/pages/Home.tsx", content: i.startsWith("CONTINUATION") ? "  return null; // END\n}\n" : "export default function Home() {\n  const a = 1;\n  cut-of" }];
      },
    });
    expect(asked.filter((a) => a.startsWith("CONTINUATION")).length).toBe(1);
    expect(r.truncated).toEqual([]);
    expect(r.units[0]!.continued).toBe(true);
    expect(r.files.find((f) => f.path === "src/pages/Home.tsx")!.content).toContain("const a = 1;\n  return null; // END");
  });
  it("creates foundation before pages so pages see real signatures", async () => {
    let sawSignature = false;
    await writePlannedPages({
      pages: [{ route: "/", file: "src/pages/Home.tsx" }],
      files: [frame],
      budget: new RecoveryBudget(),
      createFoundation: async (f) => ({ files: [...f, container], created: [container.path] }),
      request: async (i) => {
        sawSignature ||= i.includes("@/components/layout/Container: named { Container }");
        return [{ path: "src/pages/Home.tsx", content: "export default function Home(){return null}" }];
      },
    });
    expect(sawSignature).toBe(true);
  });
});

describe("provider retry", () => {
  it("retries transient failures with backoff and stops on success", async () => {
    const statuses = [503, 429, 200];
    const seen: string[] = [];
    const r = await withProviderRetry(async () => new Response("", { status: statuses.shift()! }), { sleep: async () => {}, onAttempt: (a) => seen.push(a.failureClass) });
    expect(r.status).toBe(200);
    expect(seen).toEqual(["server_error", "rate_limited", "ok"]);
  });
  it("never retries deterministic errors", async () => {
    let n = 0;
    const r = await withProviderRetry(async () => { n++; return new Response("", { status: 400 }); }, { sleep: async () => {} });
    expect(r.status).toBe(400);
    expect(n).toBe(1);
    expect(classifyProviderStatus(null)).toBe("connection");
  });
});
