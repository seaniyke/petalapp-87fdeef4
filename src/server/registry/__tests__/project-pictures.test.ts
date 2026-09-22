import { describe, expect, it } from "vitest";
import {
  MIN_SCORE,
  renderProjectPictureBlock,
  scoreProjectPicture,
  type ProjectPicture,
} from "../project-pictures.server";

const pic = (over: Partial<ProjectPicture> = {}): ProjectPicture => ({
  id: "1",
  url: "https://example.com/a.jpg",
  label: "Our bakery counter",
  tags: ["bakery", "interior"],
  ...over,
});

describe("the owner's own photos", () => {
  it("matches on what the photo is of", () => {
    expect(scoreProjectPicture(pic(), ["bakery", "counter"])).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it("does not match an unrelated request", () => {
    expect(scoreProjectPicture(pic(), ["spaceship"])).toBeLessThan(MIN_SCORE);
  });

  it("counts a tag the request names", () => {
    expect(scoreProjectPicture(pic({ label: "" }), ["interior"])).toBe(3);
  });

  it("says nothing when there are no photos", () => {
    expect(renderProjectPictureBlock([])).toBe("");
  });

  it("names each photo with its real address and asks for alt text", () => {
    const block = renderProjectPictureBlock([pic(), pic({ id: "2", label: "Front window" })]);
    expect(block).toContain("Our bakery counter");
    expect(block).toContain("https://example.com/a.jpg");
    expect(block).toContain("alt text");
  });

  it("keeps the list short even with a big album", () => {
    const many = Array.from({ length: 40 }, (_, i) => pic({ id: String(i), label: `Photo ${i}` }));
    const lines = renderProjectPictureBlock(many)
      .split("\n")
      .filter((l) => l.startsWith("- ") && l.includes("→"));
    expect(lines.length).toBe(12);
  });

  it("survives a photo with no name", () => {
    expect(renderProjectPictureBlock([pic({ label: "  ", tags: [] })])).toContain("untitled photo");
  });
});
