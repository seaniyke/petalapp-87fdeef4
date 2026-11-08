import { describe, expect, it } from "vitest";
import { canDeleteKey, objectKeyFor, safeFileName, UPLOAD_LIMITS } from "../r2-storage.server";

const P = "11111111-1111-1111-1111-111111111111";

describe("R2 uploads", () => {
  it("keeps every file inside its own project and visitor folder", () => {
    expect(objectKeyFor(P, "u1", "My Photo.jpg", "abc")).toBe(`${P}/u1/abc-My-Photo.jpg`);
    expect(objectKeyFor(P, null, "x.png", "abc")).toBe(`${P}/guest/abc-x.png`);
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
  });

  it("lets a visitor delete only their own files in this project", () => {
    expect(canDeleteKey(P, "u1", `${P}/u1/abc-x.png`)).toBe(true);
    expect(canDeleteKey(P, "u2", `${P}/u1/abc-x.png`)).toBe(false);
    expect(canDeleteKey(P, null, `${P}/guest/abc-x.png`)).toBe(false);
    expect(canDeleteKey("other", "u1", `${P}/u1/abc-x.png`)).toBe(false);
  });

  it("caps files at 5 MB", () => {
    expect(UPLOAD_LIMITS.maxBytes).toBe(5 * 1024 * 1024);
  });
});
