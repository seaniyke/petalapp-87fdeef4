import { describe, it, expect } from "vitest";
import { resolveProviderRouting } from "@/server/engine/provider-policy";
import { RecoveryBudget } from "@/server/engine/recovery-policy";

describe("single provider policy", () => {
  it("code calls: OpenInference first, DeepInfra hidden while a primary is left", () => {
    const r = resolveProviderRouting({ codeWriting: true, avoid: [] }) as { order: string[] };
    expect(r.order[0]).toBe("openinference");
    expect(r.order).not.toContain("deepinfra");
  });
  it("after OpenInference fails, Azure; after both, DeepInfra last resort", () => {
    const a = resolveProviderRouting({ codeWriting: true, avoid: ["OpenInference"] }) as { order: string[] };
    expect(a.order).toEqual(["azure"]);
    const b = resolveProviderRouting({ codeWriting: true, avoid: ["openinference", "Azure"] }) as { order: string[] };
    expect(b.order).toEqual(["deepinfra"]);
  });
  it("non-code calls only inherit exclusions", () => {
    expect(resolveProviderRouting({ codeWriting: false, avoid: [] })).toBeUndefined();
    expect(resolveProviderRouting({ codeWriting: false, avoid: ["Azure"] })).toEqual({ ignore: ["azure"] });
  });
});

describe("bounded recovery table", () => {
  it("one attempt per kind, none for browser failures", () => {
    const b = new RecoveryBudget();
    expect(b.take("provider_failure")).toBe(true);
    expect(b.take("provider_failure")).toBe(false);
    expect(b.take("browser_failure")).toBe(false);
  });
  it("one repair per file, at most three files", () => {
    const b = new RecoveryBudget();
    expect(b.take("broken_file", "a")).toBe(true);
    expect(b.take("broken_file", "a")).toBe(false);
    expect(b.take("broken_file", "b")).toBe(true);
    expect(b.take("broken_file", "c")).toBe(true);
    expect(b.take("broken_file", "d")).toBe(false);
  });
});
