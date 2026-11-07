import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/registry/pictures.server", () => ({ findLibraryPicture: async () => null }));
vi.mock("@/server/registry/project-pictures.server", () => ({ findProjectPicture: async () => null }));

import { resolvePetalImagePlaceholders } from "@/server/image-generation.server";

const page = (src: string) => [{ path: "src/pages/Home.tsx", content: `<img src="${src}" />` }];
const noSleep = async () => {};

describe("project pictures", () => {
  it("retries a transient failure and ends with a real photo, not a placeholder", async () => {
    let calls = 0;
    const generate = async () => {
      calls += 1;
      if (calls < 3) throw new Error("Image gateway error (503)");
      return { url: "https://cdn/real.png", cached: false };
    };
    const r = await resolvePetalImagePlaceholders(page("petal-image://museum-gallery"), undefined, null, undefined, { generate, sleep: noSleep });
    expect(r.files[0].content).toContain("https://cdn/real.png");
    expect(r.failed).toBe(0);
  });

  it("a picture that still fails is reported, has no caption text, and is retried on the next pass", async () => {
    const failing = async () => { throw new Error("Image gateway error (500)"); };
    const reported: string[] = [];
    const first = await resolvePetalImagePlaceholders(page("petal-image://museum-gallery"), undefined, null, undefined, {
      generate: failing, sleep: noSleep, onFailure: ({ slug }) => reported.push(slug),
    });
    expect(reported).toEqual(["museum-gallery"]);
    expect(first.failed).toBe(1);
    expect(first.files[0].content).not.toContain("%3Ctext");

    const second = await resolvePetalImagePlaceholders(first.files, undefined, null, undefined, {
      generate: async () => ({ url: "https://cdn/later.png", cached: false }), sleep: noSleep,
    });
    expect(second.files[0].content).toBe(`<img src="https://cdn/later.png" />`);
  });
});
