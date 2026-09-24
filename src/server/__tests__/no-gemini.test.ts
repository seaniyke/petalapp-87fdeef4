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

describe("Gemini is never selected for text work", () => {
  it("any Gemini request resolves to a DeepSeek model", () => {
    for (const id of ["google/gemini-2.5-flash", "google/gemini-3-flash-preview", "google/gemini-2.5-pro"]) {
      expect(coerceToConfiguredModel(id)).toMatch(/^deepseek\//);
      expect(coerceToConfiguredModel(id, { utility: true })).toMatch(/^deepseek\//);
      expect(coerceToConfiguredModel(id, { vision: true })).toMatch(/^deepseek\//);
    }
  });
  it("no server code hardcodes a Gemini text model", () => {
    const hits = walk("src/server")
      .concat(walk("src/routes/api"))
      .filter((f) => !f.endsWith("image-generation.server.ts"))
      .filter((f) => /["'`]google\/gemini-(?![0-9.]*-?flash-image)[0-9a-z.-]+["'`]/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
