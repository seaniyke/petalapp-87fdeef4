import { describe, it, expect } from "vitest";
import { splitSelector } from "../../../builder/src/selector";

describe("browser check selectors", () => {
  it("splits a CSS selector joined with a text selector", () => {
    expect(splitSelector("button:has-text('Bundles'), text=Bundles")).toEqual(["button:has-text('Bundles')", "text=Bundles"]);
  });
  it("keeps commas inside quotes and brackets", () => {
    expect(splitSelector("text='a, b'")).toEqual(["text='a, b'"]);
    expect(splitSelector("a[title='x,y'], button")).toEqual(["a[title='x,y']", "button"]);
  });
});
