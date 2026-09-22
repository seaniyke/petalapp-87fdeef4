import { describe, expect, it } from "vitest";

import { retrieve, scoreRecord, normalizeTags } from "../registry-types";
import {
  FONT_ALLOWLIST,
  FONT_PAIRINGS,
  FONTS,
  findFont,
  findPairing,
  pickFontPairings,
  renderFontBlock,
} from "../fonts";
import { ILLUSTRATIONS, pickIllustrations, renderIllustrationBlock } from "../illustrations";
import { ICONS, ICON_ALLOWLIST, findUnknownIcons, pickIcons, renderIconBlock } from "../icons";
import { DECORATIONS, HEADERS, pickHeaders, renderHeaderBlock } from "../headers";
import { MIN_SCORE, scorePicture, tokenize, type LibraryPicture } from "../pictures.server";

describe("registry retrieval", () => {
  it("normalizes and de-duplicates tags", () => {
    expect(normalizeTags([" SaaS ", "saas", "", null, "AI"])).toEqual(["saas", "ai"]);
  });

  it("scores tag overlap above text-only matches", () => {
    const record = { id: "x", kind: "font" as const, label: "x", description: "", tags: ["luxury"] };
    expect(scoreRecord(record, ["luxury"])).toBeGreaterThan(scoreRecord(record, [], "a luxury brand"));
  });

  it("always returns a menu even with no matching tags", () => {
    expect(retrieve(FONT_PAIRINGS, ["nothing-matches-this"], 3)).toHaveLength(3);
  });

  it("is stable across calls", () => {
    const a = retrieve(HEADERS, ["saas"], 3).map((r) => r.id);
    const b = retrieve(HEADERS, ["saas"], 3).map((r) => r.id);
    expect(a).toEqual(b);
  });
});

describe("fonts", () => {
  it("every pairing references known families", () => {
    for (const pair of FONT_PAIRINGS) {
      expect(findFont(pair.display), pair.display).not.toBeNull();
      expect(findFont(pair.body), pair.body).not.toBeNull();
    }
  });

  it("has no duplicate ids", () => {
    const ids = [...FONTS, ...FONT_PAIRINGS].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("retrieves luxury pairings for a luxury brief", () => {
    const ids = pickFontPairings(["luxury", "fashion"]).map((p) => p.id);
    expect(ids).toContain("editorial-luxury");
  });

  it("renders a short block, not the whole library", () => {
    const block = renderFontBlock(["saas"]);
    expect(block).toContain("[Typography");
    expect(block.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(4);
  });

  it("looks up a pairing by id", () => {
    expect(findPairing("technical")?.display).toBe("Space Grotesk");
    expect(findPairing("nope")).toBeNull();
  });

  it("covers every category with real breadth", () => {
    const byCategory = new Set(FONTS.map((f) => f.category));
    for (const c of ["sans", "serif", "display", "mono"]) expect(byCategory.has(c as never)).toBe(true);
    expect(FONTS.length).toBeGreaterThanOrEqual(35);
    expect(FONT_PAIRINGS.length).toBeGreaterThanOrEqual(20);
  });

  it("only offers families we are allowed to load", () => {
    for (const p of FONT_PAIRINGS) {
      expect(FONT_ALLOWLIST.has(p.display), p.display).toBe(true);
      expect(FONT_ALLOWLIST.has(p.body), p.body).toBe(true);
    }
  });

  it("gives every family an industry and weights", () => {
    for (const f of FONTS) {
      expect(f.industries.length, f.family).toBeGreaterThan(0);
      expect(f.weights.length, f.family).toBeGreaterThan(0);
    }
  });

  it("matches pairings to the industry in the brief", () => {
    expect(pickFontPairings(["news", "media"]).map((p) => p.id)).toContain("newsroom");
    expect(pickFontPairings(["government"]).map((p) => p.id)).toContain("civic");
  });
});

describe("imagery approach", () => {
  it("prefers a real photograph for a restaurant", () => {
    expect(pickIllustrations(["restaurant", "food"]).map((i) => i.id)).toContain("photography");
  });

  it("prefers a built interface for software", () => {
    expect(pickIllustrations(["saas", "dashboard"]).map((i) => i.id)).toContain("product-mockup");
  });

  it("states the honest-imagery rules in the block", () => {
    const block = renderIllustrationBlock(["saas"], "a developer tool");
    expect(block).toContain("alt text");
    expect(block).toContain("Use when:");
  });

  it("every approach says when it beats the alternative", () => {
    for (const i of ILLUSTRATIONS) expect(i.useWhen.length, i.id).toBeGreaterThan(10);
  });
});

describe("icons", () => {
  it("maps meanings to unique lucide names", () => {
    const ids = ICONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of ICONS) expect(i.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
  });

  it("retrieves domain-relevant icons", () => {
    const names = pickIcons(["fintech"], "a payments dashboard").map((i) => i.icon);
    expect(names).toContain("CreditCard");
  });

  it("renders the rules with the menu", () => {
    expect(renderIconBlock(["saas"])).toContain("lucide-react");
  });

  it("flags icon names outside the vocabulary", () => {
    const found = findUnknownIcons([
      { path: "src/A.tsx", content: `import { Shield, NotARealIconName } from "lucide-react";` },
      { path: "src/B.ts", content: `import { CreditCard } from "lucide-react";` },
    ]);
    expect(found.map((f) => f.name)).toEqual(["NotARealIconName"]);
    expect(ICON_ALLOWLIST.has("Shield")).toBe(true);
  });

  it("ignores non-lucide imports", () => {
    expect(
      findUnknownIcons([{ path: "src/A.tsx", content: `import { Whatever } from "./local";` }]),
    ).toHaveLength(0);
  });
});

describe("headers and decorations", () => {
  it("offers a commerce header for a store brief", () => {
    expect(pickHeaders(["commerce"]).map((h) => h.id)).toContain("header-commerce");
  });

  it("always offers 'no decoration' as a real option", () => {
    expect(DECORATIONS.map((d) => d.id)).toContain("deco-none");
  });

  it("renders mobile and contrast rules", () => {
    const block = renderHeaderBlock(["saas"], "a saas product");
    expect(block).toContain("[Header");
    expect(block).toContain("44px");
  });
});

function picture(over: Partial<LibraryPicture>): LibraryPicture {
  return {
    id: "1",
    url: "https://example.com/a.jpg",
    subject: "modern coffee shop interior",
    industry: "restaurant",
    mood: "warm",
    tone: "inviting",
    colors: ["#c9a227"],
    orientation: "landscape",
    aspect_ratio: "16:9",
    has_people: false,
    style: "photography",
    tags: ["cafe", "food", "interior"],
    source: "curated",
    license: "cc0",
    ...over,
  };
}

describe("picture matching", () => {
  it("drops filler words when tokenizing", () => {
    expect(tokenize("a hero image of the coffee shop")).toEqual(["coffee", "shop"]);
  });

  it("scores a true subject match above the usable floor", () => {
    const score = scorePicture(picture({}), tokenize("coffee-shop-interior-warm"), ["restaurant"]);
    expect(score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it("keeps an unrelated picture below the floor", () => {
    const score = scorePicture(picture({}), tokenize("crypto-trading-dashboard-chart"), ["fintech"]);
    expect(score).toBeLessThan(MIN_SCORE);
  });

  it("prefers the matching aspect ratio between equals", () => {
    const words = tokenize("coffee-shop-interior");
    const wide = scorePicture(picture({}), words, [], "16:9");
    const tall = scorePicture(picture({ aspect_ratio: "9:16" }), words, [], "16:9");
    expect(wide).toBeGreaterThan(tall);
  });
});
