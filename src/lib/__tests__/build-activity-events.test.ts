import { describe, expect, it } from "vitest";
import { appendUniqueActivity, distinctPictureUrls } from "@/lib/build-activity-events";

describe("build activity events", () => {
  it("does not append a replayed picture twice", () => {
    const event = { step: "image_resolve", message: "Made picture 1", ts: 10, url: "https://img/one.png" };
    expect(appendUniqueActivity([event], { ...event })).toEqual([event]);
  });

  it("counts distinct pictures rather than replay events", () => {
    expect(
      distinctPictureUrls([
        { step: "image_resolve", message: "one", ts: 1, url: "https://img/one.png" },
        { step: "image_resolve", message: "one replay", ts: 2, url: "https://img/one.png" },
        { step: "image_resolve", message: "two", ts: 3, url: "https://img/two.png" },
      ]),
    ).toEqual(["https://img/one.png", "https://img/two.png"]);
  });
});