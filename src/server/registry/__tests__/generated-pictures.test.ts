/**
 * Picture memory + design intent.
 *
 * Covers ownership/privacy, the quality bar, fail-open behaviour, the
 * user-words-win rule, category composition, and that nothing else changed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => from(t) },
}));

import {
  findRememberedPicture,
  rememberGeneratedPicture,
  orientationFor,
  tagsForPrompt,
} from "../generated-pictures.server";
import {
  readStatedDesignIntent,
  applyStatedIntent,
  renderStatedIntentBlock,
  renderCategoryCompositionBlock,
} from "../../design-intent.server";
import type { DesignDirection } from "../../design-director.server";

type Row = Record<string, unknown>;

/** Minimal stand-in for the query builder used by the module. */
function selectResult(rowsFor: (table: string, filters: Row) => Row[] | null) {
  return (table: string) => {
    const filters: Row = {};
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.limit = () => Promise.resolve({ data: rowsFor(table, filters), error: null });
    builder.order = chain;
    builder.eq = (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    };
    builder.upsert = (row: Row) => {
      upserts.push(row);
      return Promise.resolve({ error: null });
    };
    return builder;
  };
}

let upserts: Row[] = [];

const CAFE: Row = {
  id: "a",
  url: "https://x/cafe.png",
  subject: "modern coffee shop interior with warm light",
  style: "photography",
  mood: "warm",
  tags: ["coffee", "shop", "interior"],
  aspect_ratio: "16:9",
  orientation: "landscape",
  shared: false,
  project_id: "p1",
  owner_id: "u1",
};

beforeEach(() => {
  upserts = [];
  from.mockReset();
});

describe("picture memory — ownership and privacy", () => {
  it("reuses a picture inside the project that made it", async () => {
    from.mockImplementation(selectResult((_t, f) => (f.project_id === "p1" || f.owner_id === "u1" ? [CAFE] : [])));
    const hit = await findRememberedPicture({
      request: "modern coffee shop interior warm light",
      scope: { projectId: "p1", ownerId: "u1" },
    });
    expect(hit?.url).toBe(CAFE.url);
  });

  it("never reuses another person's private picture", async () => {
    // The row leaks through a query: the scope filter must still reject it.
    from.mockImplementation(selectResult(() => [CAFE]));
    const hit = await findRememberedPicture({
      request: "modern coffee shop interior warm light",
      scope: { projectId: "p2", ownerId: "u2" },
    });
    expect(hit).toBeNull();
  });

  it("reuses a shared picture for anyone", async () => {
    from.mockImplementation(selectResult(() => [{ ...CAFE, shared: true }]));
    const hit = await findRememberedPicture({
      request: "modern coffee shop interior warm light",
      scope: { projectId: "p9", ownerId: "u9" },
    });
    expect(hit?.url).toBe(CAFE.url);
  });

  it("reuses across the same person's other projects", async () => {
    from.mockImplementation(selectResult(() => [CAFE]));
    const hit = await findRememberedPicture({
      request: "modern coffee shop interior warm light",
      scope: { projectId: "p2", ownerId: "u1" },
    });
    expect(hit?.url).toBe(CAFE.url);
  });
});

describe("picture memory — quality bar and fail-open", () => {
  it("ignores a weak match so a new picture is made instead", async () => {
    from.mockImplementation(selectResult(() => [CAFE]));
    const hit = await findRememberedPicture({
      request: "aerial photograph of a mountain range at dusk",
      scope: { projectId: "p1", ownerId: "u1" },
    });
    expect(hit).toBeNull();
  });

  it("returns nothing when memory is empty", async () => {
    from.mockImplementation(selectResult(() => []));
    expect(
      await findRememberedPicture({ request: "coffee shop", scope: { projectId: "p1" } }),
    ).toBeNull();
  });

  it("returns nothing, not an error, when the lookup fails", async () => {
    from.mockImplementation(() => {
      throw new Error("database unreachable");
    });
    await expect(
      findRememberedPicture({ request: "coffee shop interior", scope: { projectId: "p1" } }),
    ).resolves.toBeNull();
  });

  it("returns nothing for an empty request", async () => {
    from.mockImplementation(selectResult(() => [CAFE]));
    expect(await findRememberedPicture({ request: "   " })).toBeNull();
  });
});

describe("picture memory — recording", () => {
  it("records url, words, ratio, model and ownership", async () => {
    from.mockImplementation(selectResult(() => []));
    await rememberGeneratedPicture({
      url: "https://x/new.png",
      prompt: "warm sourdough bakery counter",
      aspectRatio: "16:9",
      model: "some/model",
      scope: { projectId: "p1", ownerId: "u1", turnId: "t1" },
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      url: "https://x/new.png",
      aspect_ratio: "16:9",
      orientation: "landscape",
      model: "some/model",
      project_id: "p1",
      owner_id: "u1",
      turn_id: "t1",
    });
  });

  it("never throws when recording fails", async () => {
    from.mockImplementation(() => {
      throw new Error("write failed");
    });
    await expect(
      rememberGeneratedPicture({ url: "https://x/a.png", prompt: "a bakery" }),
    ).resolves.toBeUndefined();
  });

  it("skips recording without a url or description", async () => {
    from.mockImplementation(selectResult(() => []));
    await rememberGeneratedPicture({ url: "", prompt: "bakery" });
    await rememberGeneratedPicture({ url: "https://x/a.png", prompt: "" });
    expect(upserts).toHaveLength(0);
  });

  it("works out shape from the ratio", () => {
    expect(orientationFor("9:16")).toBe("portrait");
    expect(orientationFor("1:1")).toBe("square");
    expect(orientationFor("16:9")).toBe("landscape");
    expect(orientationFor(null)).toBe("");
  });

  it("keeps a small set of searchable words", () => {
    const tags = tagsForPrompt("a warm rustic sourdough bakery counter with morning light");
    expect(tags.length).toBeLessThanOrEqual(12);
    expect(tags).toContain("bakery");
  });
});

describe("design intent — the person's words win", () => {
  const base: DesignDirection = {
    vibe: "premium saas",
    rationale: "default",
    display_font: "Sora",
    body_font: "Inter",
    palette_mood: "cool neutral",
    density: "balanced",
    motion: "subtle",
    design_moves: ["big hero", "card grid"],
  } as DesignDirection;


  it("overrides a generic direction with a stated style", () => {
    const intent = readStatedDesignIntent("Make it brutalist");
    expect(applyStatedIntent(base, intent)?.vibe).toBe("brutalist");
  });

  it("honours a stated colour mood", () => {
    const intent = readStatedDesignIntent("dark theme, neon accents");
    expect(applyStatedIntent(base, intent)?.palette_mood).toContain("dark");
  });

  it("honours a request for no animation", () => {
    const intent = readStatedDesignIntent("clean site, no animations please");
    expect(applyStatedIntent(base, intent)?.motion).toBe("still");
  });

  it("leaves the direction untouched when nothing was stated", () => {
    const intent = readStatedDesignIntent("build a site for my bakery");
    expect(intent).toBeNull();
    expect(applyStatedIntent(base, intent)).toBe(base);
    expect(renderStatedIntentBlock(intent)).toBe("");
  });

  it("states the person's words at the top of the brief", () => {
    const block = renderStatedIntentBlock(readStatedDesignIntent("make it brutalist"));
    expect(block).toContain("brutalist");
    expect(block.toLowerCase()).toContain("overrides");
  });

  it("does nothing when there is no direction to adjust", () => {
    expect(applyStatedIntent(null, readStatedDesignIntent("make it brutalist"))).toBeNull();
  });
});

describe("design intent — composition, and no change to anything else", () => {
  it("adds composition guidance for a recognised kind of site", async () => {
    const block = await renderCategoryCompositionBlock("Build a restaurant website with a menu");
    expect(block).toContain("/menu");
  });

  it("stays silent when the kind of site is unclear", async () => {
    expect(await renderCategoryCompositionBlock("hi")).toBe("");
    expect(await renderCategoryCompositionBlock("make something nice")).toBe("");
  });

  it("makes no AI calls", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    readStatedDesignIntent("make it brutalist");
    await renderCategoryCompositionBlock("restaurant website");
    from.mockImplementation(selectResult(() => []));
    await findRememberedPicture({ request: "coffee shop", scope: { projectId: "p1" } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
