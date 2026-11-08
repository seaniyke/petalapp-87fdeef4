import { describe, expect, it } from "vitest";
import { deleteRefusal, toolsFor } from "@/server/engine/tool-loop";

const tree = new Map<string, string>([
  ["src/App.tsx", `import Home from "./pages/Home";\nexport default Home;`],
  ["src/pages/Home.tsx", `export default function Home() { return null; }`],
  ["src/pages/OldAbout.tsx", `export default function OldAbout() { return null; }`],
]);

describe("delete_file tool", () => {
  it("is offered in both loop modes", () => {
    for (const light of [true, false]) {
      expect(toolsFor(light).map((t) => t.function.name)).toContain("delete_file");
    }
  });

  it("allows deleting an orphaned page", () => {
    expect(deleteRefusal("src/pages/OldAbout.tsx", tree)).toBeNull();
  });

  it("refuses a file another file still imports", () => {
    expect(deleteRefusal("src/pages/Home.tsx", tree)).toMatch(/still imported by src\/App\.tsx/);
  });

  it("refuses entry and managed files", () => {
    expect(deleteRefusal("src/App.tsx", tree)).toMatch(/entry\/router/);
    expect(deleteRefusal("package.json", tree)).toMatch(/managed/);
    expect(deleteRefusal("tailwind.config.ts", tree)).toMatch(/managed/);
  });
});
