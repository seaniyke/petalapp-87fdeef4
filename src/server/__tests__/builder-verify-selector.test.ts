import { describe, it, expect } from "vitest";
import { normalizeSelectorPart, splitSelector } from "../../../builder/src/selector";

describe("browser check selectors", () => {
  it("splits a CSS selector joined with a text selector", () => {
    expect(splitSelector("button:has-text('Bundles'), text=Bundles")).toEqual(["button:has-text('Bundles')", "text=Bundles"]);
  });
  it("keeps commas inside quotes and brackets", () => {
    expect(splitSelector("text='a, b'")).toEqual(["text='a, b'"]);
    expect(splitSelector("a[title='x,y'], button")).toEqual(["a[title='x,y']", "button"]);
  });
  it("scopes a text selector written after a CSS section", () => {
    const parts = splitSelector("header a[href*='/book'], header text=Book appointment").map(normalizeSelectorPart);
    expect(parts).toEqual(["header a[href*='/book']", "header >> text=Book appointment"]);
  });
  it("leaves plain selectors alone", () => {
    expect(normalizeSelectorPart("text=Book now")).toBe("text=Book now");
    expect(normalizeSelectorPart("nav a.cta")).toBe("nav a.cta");
  });
});
