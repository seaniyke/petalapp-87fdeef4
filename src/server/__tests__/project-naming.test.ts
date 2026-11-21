import { describe, it, expect } from "vitest";
import { titleFromIndexHtml, titleFromPackageJson } from "@/server/agent-ops-store.server";

describe("project naming from built files", () => {
  it("derives the brand from the page title when package.json keeps the scaffold default", () => {
    expect(titleFromPackageJson(`{"name":"petal-app"}`)).toBeNull();
    expect(titleFromIndexHtml(`<html><head><title>Atelier Lace Site</title></head></html>`)).toBe("Atelier Lace");
  });

  it("keeps only the first segment of a segmented title", () => {
    expect(titleFromIndexHtml(`<title>Atelier Lace — Book your appointment</title>`)).toBe("Atelier Lace");
    expect(titleFromIndexHtml(`<title>Harbor Lane Coffee | Home</title>`)).toBe("Harbor Lane Coffee");
  });

  it("refuses generic or empty titles so a project is never named 'Site'", () => {
    expect(titleFromIndexHtml(`<title>Untitled project</title>`)).toBeNull();
    expect(titleFromIndexHtml(`<title>Website</title>`)).toBeNull();
    expect(titleFromIndexHtml(`<title></title>`)).toBeNull();
    expect(titleFromIndexHtml(`<html><head></head></html>`)).toBeNull();
  });
});
