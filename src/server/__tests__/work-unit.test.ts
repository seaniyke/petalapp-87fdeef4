import { describe, expect, it } from "vitest";
import { exportSignature, validateUnitImports, stitchContinuation, planWorkUnits, signatureContext } from "@/server/engine/work-unit";
import { withProviderRetry, classifyProviderStatus } from "@/server/engine/provider-retry";
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
