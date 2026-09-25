import { describe, it, expect } from "vitest";
import { resolveProviderRouting } from "@/server/engine/provider-policy";
import { RecoveryBudget } from "@/server/engine/recovery-policy";

describe("single provider policy", () => {
  it("code calls: OpenRouter native routing, failed upstreams ignored", () => {
    const r = resolveProviderRouting({ codeWriting: true, avoid: ["OpenInference"] }) as { ignore: string[]; only?: string[] };
    expect(r.only).toBeUndefined();
    expect(r.ignore).toContain("openinference");
  });
  it("non-code calls only inherit exclusions", () => {
    expect(resolveProviderRouting({ codeWriting: false, avoid: [] })).toBeUndefined();
    expect(resolveProviderRouting({ codeWriting: false, avoid: ["Azure"] })).toEqual({ ignore: ["azure"] });
  });
});

describe("bounded recovery table", () => {
  it("two provider switches, none for browser failures", () => {
    const b = new RecoveryBudget();
    expect(b.take("provider_failure")).toBe(true);
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
