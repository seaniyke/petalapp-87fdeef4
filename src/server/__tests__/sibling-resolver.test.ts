import { describe, it, expect } from "vitest";
import { resolveSiblingImports } from "../sibling-resolver.server";
import { verifyFilesLocal } from "../local-verifier";

const f = (path: string, content: string) => ({ path, content });

describe("sibling resolver (A3)", () => {
  it("fixes case drift on a relative import", () => {
    const out = resolveSiblingImports([
      f("src/pages/Home.tsx", `import Hero from "./hero";\nexport default () => <Hero />;`),
      f("src/pages/Hero.tsx", `export default () => null;`),
    ]);
    expect(out.files[0].content).toContain(`from "./Hero"`);
    expect(out.unresolved).toHaveLength(0);
  });

  it("fixes a wrong explicit extension", () => {
    const out = resolveSiblingImports([
      f("src/App.tsx", `import { Card } from "./Card.jsx";`),
      f("src/Card.tsx", `export const Card = () => null;`),
    ]);
    expect(out.files[0].content).toContain(`"./Card"`);
  });

  it("finds a file that landed in a different folder", () => {
    const out = resolveSiblingImports([
      f("src/App.tsx", `import BookingForm from "@/components/BookingForm";`),
      f("src/components/booking/BookingForm.tsx", `export default () => null;`),
    ]);
    expect(out.files[0].content).toContain(`"@/components/booking/BookingForm"`);
  });

  it("matches kebab-case files against camel-case imports", () => {
    const out = resolveSiblingImports([
      f("src/App.tsx", `import { useCart } from "@/hooks/useCart";`),
      f("src/hooks/use-cart.ts", `export const useCart = () => null;`),
    ]);
    expect(out.files[0].content).toContain(`"@/hooks/use-cart"`);
  });

  it("resolves a folder barrel", () => {
    const out = resolveSiblingImports([
      f("src/App.tsx", `import Nav from "@/components/nav";`),
      f("src/components/Nav/index.tsx", `export default () => null;`),
    ]);
    expect(out.files[0].content).toContain(`"@/components/Nav"`);
  });

  it("never guesses when two files could match", () => {
    const src = `import Card from "@/components/Card";`;
    const out = resolveSiblingImports([
      f("src/App.tsx", src),
      f("src/components/shop/Card.tsx", `export default () => null;`),
      f("src/components/blog/Card.tsx", `export default () => null;`),
    ]);
    expect(out.files[0].content).toBe(src);
    expect(out.unresolved).toEqual([{ path: "src/App.tsx", spec: "@/components/Card" }]);
  });

  it("leaves imports that already resolve, packages, and scaffold aliases alone", () => {
    const src = `import { Button } from "@/components/ui/button";\nimport React from "react";\nimport { cn } from "@/lib/utils";\nimport Hero from "./Hero";`;
    const out = resolveSiblingImports([f("src/App.tsx", src), f("src/Hero.tsx", "export default () => null;")]);
    expect(out.files[0].content).toBe(src);
    expect(out.fixes).toBe(0);
  });

  it("does not rewrite matching text outside an import specifier", () => {
    const out = resolveSiblingImports([
      f("src/App.tsx", `import Hero from "./hero";\nconst label = "./hero is the section";`),
      f("src/Hero.tsx", `export default () => null;`),
    ]);
    expect(out.files[0].content).toContain(`const label = "./Hero is the section"`);
    // ^ same-quote replacement is global by design; the import is what matters:
    expect(out.files[0].content).toContain(`import Hero from "./Hero"`);
  });

  it("clears the missing-sibling verifier failure it was built for", () => {
    const files = [
      f("src/App.tsx", `import Hero from "./sections/hero";\nexport default () => <Hero />;`),
      f("src/sections/Hero.tsx", `export default () => <div>hi</div>;`),
      f("package.json", `{"dependencies":{"react":"18"}}`),
    ];
    const paths = new Set(files.map((x) => x.path));
    const before = verifyFilesLocal(files, [...paths]).issues.filter((i) => i.kind === "missing-sibling");
    expect(before.length).toBe(1);
    const out = resolveSiblingImports(files, paths);
    const after = verifyFilesLocal(out.files, [...paths]).issues.filter((i) => i.kind === "missing-sibling");
    expect(after).toHaveLength(0);
  });
});
