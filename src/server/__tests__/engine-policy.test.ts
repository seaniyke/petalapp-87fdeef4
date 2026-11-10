import { describe, it, expect } from "vitest";
import { resolveProviderRouting } from "@/server/engine/provider-policy";
import { RecoveryBudget } from "@/server/engine/recovery-policy";

describe("single provider policy", () => {
  it("no provider block is ever sent — the gateway owns upstream failover", () => {
    expect(resolveProviderRouting({ codeWriting: true, avoid: ["OpenInference"] })).toBeUndefined();
    expect(resolveProviderRouting({ codeWriting: false, avoid: [] })).toBeUndefined();
    expect(resolveProviderRouting({ codeWriting: false, avoid: ["Azure"] })).toBeUndefined();
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
    b.take("broken_file", "a"); b.take("broken_file", "a");
    expect(b.take("broken_file", "a")).toBe(false);
    expect(b.take("broken_file", "b")).toBe(true);
    expect(b.take("broken_file", "c")).toBe(true);
    expect(b.take("broken_file", "d")).toBe(true);
  });
});
