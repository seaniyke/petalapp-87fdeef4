/**
 * Design variety pipeline: more looks, per-project rotation within the
 * brief's family, layout archetypes, and the Custard API style choice.
 */
import { describe, expect, it } from "vitest";
import { getDesignSystem, listDesignSystems } from "@/server/design-systems/registry";
import { resolvePackageForIntent } from "@/server/design-systems/authority";
import { PUBLIC_LOOK_SLUGS, LAYOUT_ARCHETYPE_IDS, sanitizeStyleChoice } from "@/server/design/style-catalog";
import { pickLayoutArchetype, renderLayoutArchetypeBlock } from "@/server/design/layout-archetypes";
import {
  fallbackDesignDirection,
  renderDesignDirectionBlock,
  withCommittedStyle,
} from "@/server/design-director.server";
import { commitDesignSystem } from "@/server/design/design-system.server";
import { loadCoreKnowledge } from "@/server/agent-knowledge";
import { handleMcpPayload, type ApiCall } from "@/server/mcp/custard-mcp";
import type { PicUnderstanding } from "@/server/pic/pic-types";

const seeds = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const understanding = {
  summary: "", productType: "website", domain: "bakery", platforms: ["web"],
  surfaces: { marketing: true, application: false, admin: false }, firstVersion: [],
} as unknown as PicUnderstanding;

describe("looks", () => {
  it("every public look is installed and valid", () => {
    for (const slug of PUBLIC_LOOK_SLUGS) {
      const pkg = getDesignSystem(slug);
      expect(pkg, slug).toBeTruthy();
      expect(pkg!.meta.fonts.length).toBe(2);
      expect(pkg!.accents[pkg!.meta.default_accent]).toBeTruthy();
    }
    expect(listDesignSystems().length).toBeGreaterThanOrEqual(9);
  });

  it("new looks carry distinct font pairs", () => {
    const pairs = PUBLIC_LOOK_SLUGS.map((s) => getDesignSystem(s)!.meta.fonts.join("+"));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("look rotation", () => {
  it("one project always keeps its look", () => {
    const a = resolvePackageForIntent("a bakery website", { seed: seeds[3] });
    const b = resolvePackageForIntent("a bakery website", { seed: seeds[3] });
    expect(`${a?.pkg.meta.slug}/${a?.accent}`).toBe(`${b?.pkg.meta.slug}/${b?.accent}`);
  });

  it("the same brief on different projects spreads across looks", () => {
    const picks = new Set(seeds.map((s) => resolvePackageForIntent("a bakery website", { seed: s })?.pkg.meta.slug));
    expect(picks.size).toBeGreaterThanOrEqual(3);
    const generic = new Set(seeds.map((s) => resolvePackageForIntent("something entirely unremarkable", { seed: s })?.pkg.meta.slug));
    expect(generic.size).toBeGreaterThanOrEqual(4);
  });

  it("a clinic only rotates within the calm care look", () => {
    for (const s of seeds) expect(resolvePackageForIntent("a dental clinic website", { seed: s })?.pkg.meta.slug).toBe("haven");
  });

  it("explicit style words and dark requests lock the look", () => {
    for (const s of seeds.slice(0, 10)) {
      expect(resolvePackageForIntent("a playful bakery website", { seed: s })?.pkg.meta.slug).toBe("bloom");
      expect(resolvePackageForIntent("a brutalist developer API site", { seed: s })?.pkg.meta.slug).toBe("brutalist");
      expect(resolvePackageForIntent("a swiss style architecture studio", { seed: s })?.pkg.meta.slug).toBe("monolith");
      expect(resolvePackageForIntent("a high-energy gym", { seed: s })?.pkg.meta.slug).toBe("kinetic");
      expect(resolvePackageForIntent("a dark cocktail bar", { seed: s })?.pkg.meta.slug).toBe("obsidian");
    }
  });

  it("a caller's look wins over the brief", () => {
    expect(resolvePackageForIntent("a dental clinic", { look: "monolith", seed: seeds[0] })?.pkg.meta.slug).toBe("monolith");
    expect(resolvePackageForIntent("a dental clinic", { look: "not-a-look" })?.pkg.meta.slug).toBe("haven");
  });

  it("the committed design record follows the caller's look", async () => {
    const direction = withCommittedStyle(fallbackDesignDirection("a bakery site", "p1"), "a bakery site", "p1", { look: "kinetic" });
    const design = await commitDesignSystem({ brief: "a bakery site", understanding, direction, seed: "p1" });
    expect(design.package?.systemId).toBe("kinetic");
    expect(design.typography.displayFont).toBe("Syne");
  });
});

describe("layout archetypes", () => {
  it("explicit layout words win", () => {
    expect(pickLayoutArchetype("a bento grid landing for my SaaS", "x")).toBe("bento-showcase");
    expect(pickLayoutArchetype("a split screen hotel booking page", "x")).toBe("split-screen");
    expect(pickLayoutArchetype("photography portfolio with a masonry grid", "x")).toBe("visual-gallery");
  });

  it("single-purpose tools open on the tool", () => {
    expect(pickLayoutArchetype("a mortgage calculator")).toBe("app-first");
  });

  it("similar briefs on different projects get different layouts; one project keeps its own", () => {
    const set = new Set(seeds.map((s) => pickLayoutArchetype("a restaurant website", s)));
    expect(set.size).toBeGreaterThanOrEqual(2);
    expect(pickLayoutArchetype("a restaurant website", seeds[5])).toBe(pickLayoutArchetype("a restaurant website", seeds[5]));
  });

  it("the block never adds pages and replaces the fixed section stack", () => {
    for (const id of LAYOUT_ARCHETYPE_IDS) {
      const block = renderLayoutArchetypeBlock(id);
      expect(block).toContain("never adds pages");
      expect(block).toContain("replaces the generic stack");
    }
  });
});

describe("design direction carries the archetype", () => {
  const base = fallbackDesignDirection("a bakery website", "p1");

  it("new directions commit one; a caller layout wins; a committed one is kept", () => {
    expect(LAYOUT_ARCHETYPE_IDS).toContain(base.layout_archetype);
    expect(withCommittedStyle(base, "a bakery website", "p1", { layout: "swiss-minimal" }).layout_archetype).toBe("swiss-minimal");
    const kept = withCommittedStyle({ ...base, layout_archetype: "split-screen" }, "a bakery website", "other-seed");
    expect(kept.layout_archetype).toBe("split-screen");
  });

  it("full, compact and phone-app rendering", () => {
    const d = { ...base, layout_archetype: "visual-gallery" as const };
    expect(renderDesignDirectionBlock(d, { detail: "full", packageOwnsVisuals: true })).toContain("### Layout archetype");
    expect(renderDesignDirectionBlock(d, { detail: "compact", packageOwnsVisuals: true })).toContain("layout archetype: Visual gallery");
    expect(renderDesignDirectionBlock(d, { detail: "full", includeLayout: false })).not.toContain("Layout archetype");
  });

  it("older projects without an archetype are unchanged", () => {
    const { layout_archetype: _x, ...old } = base;
    expect(renderDesignDirectionBlock(old, { detail: "full" })).not.toContain("Layout archetype");
  });
});

describe("manual and API", () => {
  it("the core manual no longer prescribes one fixed home-page section list", () => {
    const t = loadCoreKnowledge("full").text;
    expect(t).not.toContain("- Testimonials Section");
    expect(t).not.toContain("Hero → Features → Testimonials → Pricing → FAQ → CTA → Footer");
    expect(t).toContain("There is no fixed section list.");
  });

  it("style choices are sanitised", () => {
    expect(sanitizeStyleChoice({ layout: "bento-showcase", look: "bloom" })).toEqual({ layout: "bento-showcase", look: "bloom" });
    expect(sanitizeStyleChoice({ layout: "nope", look: "bloom" })).toEqual({ look: "bloom" });
    expect(sanitizeStyleChoice({ layout: "nope" })).toBeNull();
  });

  it("MCP create forwards a style choice to /generate", async () => {
    const seen: unknown[] = [];
    const call: ApiCall = async (method, path, body) => {
      seen.push(body);
      if (path === "/projects") return new Response(JSON.stringify({ project: { id: "11111111-1111-4111-8111-111111111111" } }), { status: 201 });
      return new Response(`data: ${JSON.stringify({ type: "turn_id", turnId: "22222222-2222-4222-8222-222222222222" })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    };
    const out = (await handleMcpPayload(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "custard_create_web_app", arguments: { prompt: "A bakery", style: { layout: "split-screen", look: "bloom" } } } },
      call,
    )) as { result: { isError: boolean } };
    expect(out.result.isError).toBe(false);
    expect(seen[1]).toMatchObject({ style: { layout: "split-screen", look: "bloom" } });
  });
});
