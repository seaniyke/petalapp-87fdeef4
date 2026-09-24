import { describe, it, expect } from "vitest";
import { assessCompleteness, incompleteBuildMessage, requestedRoutesFor } from "@/server/engine/build-state";

const prompt = "Build a website for Rise & Crumb. Pages: Home, Menu, About, Contact. Responsive.";
const app = (paths: string[]) => ({
  path: "src/App.tsx",
  content: paths.map((p) => `<Route path="${p}" />`).join("\n"),
});

describe("authoritative build state", () => {
  it("requested scope comes from the user's words", () => {
    expect(requestedRoutesFor(prompt, [])).toEqual(["/", "/menu", "/about", "/contact"]);
  });
  it("Home + Contact only is INCOMPLETE (the smoke-test failure)", () => {
    const v = assessCompleteness({
      requestedRoutes: requestedRoutesFor(prompt, []),
      files: [app(["/", "/contact"]), { path: "src/pages/Home.tsx", content: "" }, { path: "src/pages/Contact.tsx", content: "" }],
    });
    expect(v.complete).toBe(false);
    expect(v.missingRoutes).toEqual(["/menu", "/about"]);
    expect(incompleteBuildMessage(v.missingRoutes)).toMatch(/Menu and About weren't created/);
  });
  it("all four pages registered is complete", () => {
    const v = assessCompleteness({
      requestedRoutes: requestedRoutesFor(prompt, []),
      files: [
        app(["/", "/menu", "/about", "/contact"]),
        ...["Home", "Menu", "About", "Contact"].map((n) => ({ path: `src/pages/${n}.tsx`, content: "" })),
      ],
    });
    expect(v).toEqual({ complete: true, missingRoutes: [] });
  });
  it("a page file no route registers counts as missing", () => {
    const v = assessCompleteness({
      requestedRoutes: ["/", "/menu"],
      files: [app(["/"]), { path: "src/pages/Home.tsx", content: "" }, { path: "src/pages/Menu.tsx", content: "" }],
    });
    expect(v.missingRoutes).toEqual(["/menu"]);
  });
});
