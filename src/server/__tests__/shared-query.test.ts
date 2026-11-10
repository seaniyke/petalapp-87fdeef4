import { describe, expect, it } from "vitest";
import { columnFor, likePattern, parseSort, parseWhere, sortColumn } from "../shared-query";

describe("shared record filters", () => {
  it("a plain value means equals", () => {
    expect(parseWhere('{"category":"dessert"}')).toEqual([{ op: "eq", field: "category", value: "dessert" }]);
  });
  it("supports ranges, lists and text search", () => {
    expect(parseWhere('{"price":{"gte":5,"lte":20},"tag":{"in":["a","b"]},"title":{"contains":"cake"}}')).toEqual([
      { op: "gte", field: "price", value: 5 },
      { op: "lte", field: "price", value: 20 },
      { op: "in", field: "tag", value: ["a", "b"] },
      { op: "contains", field: "title", value: "cake" },
    ]);
  });
  it("rejects unknown operators, bad field names and nested objects", () => {
    expect(() => parseWhere('{"price":{"regex":".*"}}')).toThrow(/Unknown filter/);
    expect(() => parseWhere('{"data->>x":"y"}')).toThrow(/Invalid field/);
    expect(() => parseWhere('{"a":{"eq":{"b":1}}}')).toThrow();
    expect(() => parseWhere("not json")).toThrow(/JSON/);
  });
  it("allows at most 10 filters and 50 list values", () => {
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, i]));
    expect(() => parseWhere(JSON.stringify(eleven))).toThrow(/Too many/);
    expect(() => parseWhere(JSON.stringify({ t: { in: Array.from({ length: 51 }, (_, i) => i) } }))).toThrow(/too many/);
  });
  it("numbers compare as numbers, text as text", () => {
    expect(columnFor("price", 9)).toBe("data->price");
    expect(columnFor("category", "dessert")).toBe("data->>category");
    expect(columnFor("createdAt", "2026-01-01")).toBe("created_at");
  });
  it("sort: '-' means descending; columns map to record dates", () => {
    expect(parseSort("-price")).toEqual({ field: "price", ascending: false });
    expect(parseSort("createdAt")).toEqual({ field: "createdAt", ascending: true });
    expect(sortColumn("createdAt")).toBe("created_at");
    expect(sortColumn("price")).toBe("data->price");
    expect(parseSort(null)).toBeNull();
  });
  it("contains matches literal % and _", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
  });
});
