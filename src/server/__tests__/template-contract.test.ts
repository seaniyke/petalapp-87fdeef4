import { describe, expect, it } from "vitest";
import { KIT_FILES } from "@/server/scaffold-kit";
import { isScaffoldOwnedPath, scaffoldOwnershipReason } from "@/server/scaffold-ownership.server";
import { renderTemplateMetadataSection, templateContract } from "@/server/engine/template-contract";
import { CORRECTNESS_RULES, firstBuildBrief } from "@/server/engine/first-build";

describe("template.json project contract", () => {
  it("ships with the scaffold kit and overwrites", () => {
    const f = KIT_FILES.find((k) => k.path === "template.json");
    expect(f).toBeTruthy();
    expect(f!.overwrite).toBe(true);
  });

  it("is scaffold-owned so the model cannot rewrite it", () => {
    expect(isScaffoldOwnedPath("template.json")).toBe(true);
    expect(scaffoldOwnershipReason("template.json")).toMatch(/never write it/);
  });

  it("derives the shadcn inventory from the kit itself", () => {
    const c = templateContract();
    expect(c).toBeTruthy();
    const names = c!["shadcn_components"] as string[];
    expect(names).toContain("button");
    expect(names).toContain("dialog");
    expect(names.length).toBeGreaterThan(20);
  });

  it("states the real routing and styling contract", () => {
    const c = templateContract()!;
    expect((c["file_structure"] as Record<string, string>)["routes_file"]).toBe("src/App.tsx");
    expect((c["styling"] as Record<string, string>)["icon_set"]).toBe("lucide-react");
    expect(c["routing_pattern"]).toBe("react-router");
  });
});

describe("pre-loaded template metadata", () => {
  it("renders layout, kit and protected files without a read round trip", () => {
    const s = renderTemplateMetadataSection();
    expect(s).toMatch(/do not read it/);
    expect(s).toMatch(/src\/App\.tsx/);
    expect(s).toMatch(/lucide-react/);
    expect(s).toMatch(/@\/components\/ui/);
  });

  it("is included in the first-build brief along with correctness rules", () => {
    const brief = firstBuildBrief("a bakery site", [{ route: "/", file: "src/pages/Home.tsx" }], []);
    expect(brief).toMatch(/Project contract/);
    expect(brief).toMatch(/BrowserRouter/);
    expect(brief).toContain(CORRECTNESS_RULES.split("\n")[0]);
  });
});
