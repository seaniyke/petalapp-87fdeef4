import { describe, expect, it } from "vitest";
import { parseVisualDefects } from "@/server/visual-qa.server";

const shots = [
  { path: "/", width: 390, image: "data:image/jpeg;base64,x" },
  { path: "/", width: 1440, image: "data:image/jpeg;base64,x" },
];

describe("visual QA parsing", () => {
  it("returns [] for clean screens", () => {
    expect(parseVisualDefects('{"defects":[]}', shots)).toEqual([]);
  });

  it("keeps provable defects and mentions the widths", () => {
    const out = parseVisualDefects(
      '{"defects":[{"kind":"overlap","where":"hero","detail":"Headline sits on top of the CTA button."}]}',
      shots,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Visual QA (overlap)");
    expect(out[0]).toContain("hero");
    expect(out[0]).toContain("390px / 1440px");
  });

  it("drops taste notes and unknown kinds", () => {
    const out = parseVisualDefects(
      '{"defects":[{"kind":"taste","where":"hero","detail":"Could be more modern."},{"kind":"cramped","detail":"Buttons touch the screen edge."}]}',
      shots,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("cramped");
  });

  it("survives junk output", () => {
    expect(parseVisualDefects("sorry, I cannot", shots)).toEqual([]);
    expect(parseVisualDefects('{"defects": nope}', shots)).toEqual([]);
  });

  it("dedupes identical findings", () => {
    const out = parseVisualDefects(
      '{"defects":[{"kind":"blank","where":"page","detail":"Only a spinner is visible."},{"kind":"blank","where":"page","detail":"Only a spinner is visible."}]}',
      shots,
    );
    expect(out).toHaveLength(1);
  });
});
