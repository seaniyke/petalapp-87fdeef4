import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { coerceToConfiguredModel } from "@/lib/ai-model-config";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("only configured gateway models reach the wire", () => {
  it("any legacy or unknown slug resolves to a configured model", () => {
    for (const id of ["google/gemini-2.5-flash", "google/gemini-3-flash-preview", "google/gemini-2.5-pro", "deepseek/deepseek-v4-flash"]) {
      expect(coerceToConfiguredModel(id)).toBe("google/gemini-3.8-flash");
      expect(coerceToConfiguredModel(id, { utility: true })).toBe("google/gemini-3.1-flash-lite");
      expect(coerceToConfiguredModel(id, { vision: true })).toBe("google/gemini-3.8-flash");
    }
  });
  it("no server code hardcodes a retired model id", () => {
    const hits = walk("src/server")
      .concat(walk("src/routes/api"))
      .filter((f) => /["'`](deepseek\/|google\/gemini-2\.|anthropic\/claude-(sonnet-4|haiku-4\.5)|openai\/gpt-5["'`])/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
